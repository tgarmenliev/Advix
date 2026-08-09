import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionBasis,
  CommissionLoanCategory,
  CommissionScheme,
  CommissionSchemeType,
  CommissionTier,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CommissionTierDto } from './dto/commission-tier.dto';
import { CreateCommissionSchemeDto } from './dto/create-commission-scheme.dto';
import { UpdateCommissionSchemeDto } from './dto/update-commission-scheme.dto';

export type SchemeWithTiers = CommissionScheme & { tiers: CommissionTier[] };

@Injectable()
export class CommissionSchemesService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(
    bankId: string,
    dto: CreateCommissionSchemeDto,
  ): Promise<SchemeWithTiers> {
    const bank = await this.db.bank.findUnique({ where: { id: bankId } });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }

    const validFrom = new Date(dto.validFrom);
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    this.assertValidityRange(validFrom, validTo);
    this.assertShape(dto.basis, dto);
    this.assertTiers(dto.basis, dto.tiers);
    await this.assertNoOverlappingValidity(
      bankId,
      dto.schemeType,
      dto.loanCategory,
      validFrom,
      validTo,
    );

    const { tiers, validFrom: _f, validTo: _t, ...rest } = dto;
    return this.db.commissionScheme.create({
      data: {
        ...rest,
        bankId,
        validFrom,
        validTo,
        tiers: tiers?.length ? { create: tiers } : undefined,
      },
      include: { tiers: { orderBy: { minVolume: 'asc' } } },
    });
  }

  findAllForBank(bankId: string): Promise<SchemeWithTiers[]> {
    return this.db.commissionScheme.findMany({
      where: { bankId },
      include: { tiers: { orderBy: { minVolume: 'asc' } } },
      orderBy: [
        { schemeType: 'asc' },
        { loanCategory: 'asc' },
        { validFrom: 'desc' },
      ],
    });
  }

  async findOne(id: string): Promise<SchemeWithTiers> {
    const scheme = await this.db.commissionScheme.findUnique({
      where: { id },
      include: { tiers: { orderBy: { minVolume: 'asc' } } },
    });
    if (!scheme) {
      throw new NotFoundException('Commission scheme not found');
    }
    return scheme;
  }

  /**
   * Действащата схема за банка × вид × категория към дадена дата.
   * Връща null, ако няма конфигурирана схема — извикващият решава дали това е
   * грешка (при изчисление) или просто липса на настройка (при преглед).
   */
  async resolveActive(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    at: Date = new Date(),
  ): Promise<SchemeWithTiers | null> {
    return this.db.commissionScheme.findFirst({
      where: {
        bankId,
        schemeType,
        loanCategory,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      include: { tiers: { orderBy: { minVolume: 'asc' } } },
      orderBy: { validFrom: 'desc' },
    });
  }

  async update(
    id: string,
    dto: UpdateCommissionSchemeDto,
  ): Promise<SchemeWithTiers> {
    const existing = await this.findOne(id);

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : existing.validFrom;
    const validTo =
      dto.validTo !== undefined
        ? dto.validTo
          ? new Date(dto.validTo)
          : null
        : existing.validTo;
    this.assertValidityRange(validFrom, validTo);

    // Формата се проверява върху СЛЕТИЯ резултат — иначе частична редакция може
    // да остави схемата в невалидно състояние
    const basis = dto.basis ?? existing.basis;
    const merged = {
      flatPercent: dto.flatPercent ?? existing.flatPercent ?? undefined,
      periodType: dto.periodType ?? existing.periodType ?? undefined,
      evaluationMode:
        dto.evaluationMode ?? existing.evaluationMode ?? undefined,
    };
    this.assertShape(basis, merged);

    const tiers = dto.tiers ?? existing.tiers;
    this.assertTiers(basis, tiers);

    await this.assertNoOverlappingValidity(
      existing.bankId,
      existing.schemeType,
      existing.loanCategory,
      validFrom,
      validTo,
      id,
    );

    const { tiers: tiersDto, validFrom: _f, validTo: _t, ...rest } = dto;
    return this.db.$transaction(async (tx) => {
      if (tiersDto) {
        // Скалите се заменят изцяло — по-предвидимо от частично редактиране
        await tx.commissionTier.deleteMany({ where: { schemeId: id } });
      }
      return tx.commissionScheme.update({
        where: { id },
        data: {
          ...rest,
          validFrom,
          validTo,
          ...(tiersDto ? { tiers: { create: tiersDto } } : {}),
        },
        include: { tiers: { orderBy: { minVolume: 'asc' } } },
      });
    });
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.findOne(id);
    await this.db.commissionScheme.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Валидации
  // ---------------------------------------------------------------------------

  private assertValidityRange(validFrom: Date, validTo: Date | null): void {
    if (validTo && validTo <= validFrom) {
      throw new BadRequestException('validTo must be after validFrom');
    }
  }

  /** Полетата, които всяка основа изисква (и които не ѝ трябват). */
  private assertShape(
    basis: CommissionBasis,
    values: {
      flatPercent?: number | null;
      periodType?: unknown;
      evaluationMode?: unknown;
    },
  ): void {
    if (basis === CommissionBasis.FLAT_PERCENT) {
      if (values.flatPercent == null) {
        throw new BadRequestException(
          'flatPercent is required when basis is FLAT_PERCENT',
        );
      }
      return;
    }
    // VOLUME_TIERED
    if (!values.periodType) {
      throw new BadRequestException(
        'periodType is required when basis is VOLUME_TIERED',
      );
    }
    if (!values.evaluationMode) {
      throw new BadRequestException(
        'evaluationMode is required when basis is VOLUME_TIERED',
      );
    }
  }

  /**
   * Скалите трябва да покриват обема без дупки и без застъпване:
   * започват от 0, всяка следваща започва точно там, където свършва
   * предишната, и последната е без горна граница.
   */
  private assertTiers(
    basis: CommissionBasis,
    tiers?: Array<CommissionTierDto | CommissionTier>,
  ): void {
    if (basis === CommissionBasis.FLAT_PERCENT) {
      if (tiers && tiers.length > 0) {
        throw new BadRequestException(
          'Tiers are not allowed when basis is FLAT_PERCENT',
        );
      }
      return;
    }

    if (!tiers || tiers.length === 0) {
      throw new BadRequestException(
        'At least one tier is required when basis is VOLUME_TIERED',
      );
    }

    const sorted = [...tiers].sort((a, b) => a.minVolume - b.minVolume);

    if (sorted[0].minVolume !== 0) {
      throw new BadRequestException('The first tier must start at volume 0');
    }

    sorted.forEach((tier, index) => {
      const isLast = index === sorted.length - 1;
      const max = tier.maxVolume ?? null;

      if (!isLast && max === null) {
        throw new BadRequestException(
          'Only the last tier may be open-ended (without maxVolume)',
        );
      }
      if (isLast && max !== null) {
        throw new BadRequestException(
          'The last tier must be open-ended (without maxVolume)',
        );
      }
      if (max !== null && max <= tier.minVolume) {
        throw new BadRequestException(
          `Tier maxVolume (${max}) must be greater than minVolume (${tier.minVolume})`,
        );
      }
      if (!isLast && sorted[index + 1].minVolume !== max) {
        throw new BadRequestException(
          `Tiers must be contiguous: expected the next tier to start at ${max}, ` +
            `but it starts at ${sorted[index + 1].minVolume}`,
        );
      }
    });
  }

  /** Две схеми за един и същ ключ не може да важат едновременно. */
  private async assertNoOverlappingValidity(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    validFrom: Date,
    validTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.db.commissionScheme.findFirst({
      where: {
        bankId,
        schemeType,
        loanCategory,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        // съществуващата свършва след началото на новата…
        OR: [{ validTo: null }, { validTo: { gt: validFrom } }],
        // …и започва преди края на новата
        ...(validTo ? { validFrom: { lt: validTo } } : {}),
      },
    });

    if (overlapping) {
      throw new ConflictException(
        `Another ${schemeType} scheme for ${loanCategory} already covers this period ` +
          `(valid from ${overlapping.validFrom.toISOString().slice(0, 10)})`,
      );
    }
  }
}
