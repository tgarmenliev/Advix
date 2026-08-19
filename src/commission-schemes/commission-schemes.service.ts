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

function tierInclude() {
  return {
    tiers: {
      orderBy: [{ minVolume: 'asc' }, { minCount: 'asc' }] as Array<
        Record<string, 'asc'>
      >,
    },
  };
}

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
      dto.label ?? null,
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
      include: tierInclude(),
    });
  }

  findAllForBank(bankId: string): Promise<SchemeWithTiers[]> {
    return this.db.commissionScheme.findMany({
      where: { bankId },
      include: tierInclude(),
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
      include: tierInclude(),
    });
    if (!scheme) {
      throw new NotFoundException('Commission scheme not found');
    }
    return scheme;
  }

  /**
   * Действащата схема за банка × вид × категория към дадена дата — за
   * категориите с точно една схема (MORTGAGE/CONSUMER, обичайно и BUSINESS).
   * Ако за комбинацията има повече от една активна схема (различни label-и —
   * бизнес подкатегории), връща произволна от тях; извикващият трябва да е
   * проверил преди това с findActiveSchemes, че съвпадението е еднозначно.
   */
  async resolveActive(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    at: Date = new Date(),
  ): Promise<SchemeWithTiers | null> {
    return this.db.commissionScheme.findFirst({
      where: this.activeWhere(bankId, schemeType, loanCategory, at),
      include: tierInclude(),
      orderBy: { validFrom: 'desc' },
    });
  }

  /**
   * Всички активни схеми за банка × вид × категория към дадена дата.
   * Когато има повече от една (бизнес подкатегории, разграничени по label),
   * изборът коя да се приложи е ръчен — вижте CommissionsService.recalculate.
   */
  async findActiveSchemes(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    at: Date = new Date(),
  ): Promise<SchemeWithTiers[]> {
    return this.db.commissionScheme.findMany({
      where: this.activeWhere(bankId, schemeType, loanCategory, at),
      include: tierInclude(),
      orderBy: { label: 'asc' },
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

    const label = dto.label !== undefined ? (dto.label ?? null) : existing.label;
    await this.assertNoOverlappingValidity(
      existing.bankId,
      existing.schemeType,
      existing.loanCategory,
      label,
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
        include: tierInclude(),
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

  private activeWhere(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    at: Date,
  ) {
    return {
      bankId,
      schemeType,
      loanCategory,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    };
  }

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
    // VOLUME_TIERED или COUNT_TIERED — и двете се отчитат за календарен период
    if (!values.periodType) {
      throw new BadRequestException(
        `periodType is required when basis is ${basis}`,
      );
    }
    if (!values.evaluationMode) {
      throw new BadRequestException(
        `evaluationMode is required when basis is ${basis}`,
      );
    }
  }

  /**
   * Скалите трябва да покриват обема/броя без дупки и без застъпване:
   * започват от 0, всяка следваща започва точно там, където свършва
   * предишната, и последната е без горна граница.
   *
   * VOLUME_TIERED ползва minVolume/maxVolume (стотинки), COUNT_TIERED ползва
   * minCount/maxCount (брой сделки) — логиката на валидацията е идентична,
   * само измерението е различно.
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
        `At least one tier is required when basis is ${basis}`,
      );
    }

    const isCount = basis === CommissionBasis.COUNT_TIERED;
    const minField = isCount ? 'minCount' : 'minVolume';
    const maxField = isCount ? 'maxCount' : 'maxVolume';
    const getMin = (t: CommissionTierDto | CommissionTier): number | null =>
      (isCount ? t.minCount : t.minVolume) ?? null;
    const getMax = (t: CommissionTierDto | CommissionTier): number | null =>
      (isCount ? t.maxCount : t.maxVolume) ?? null;

    for (const tier of tiers) {
      if (getMin(tier) === null) {
        throw new BadRequestException(
          `Each tier requires ${minField} when basis is ${basis}`,
        );
      }
    }

    const sorted = [...tiers].sort((a, b) => getMin(a)! - getMin(b)!);

    if (getMin(sorted[0]) !== 0) {
      throw new BadRequestException(`The first tier must start at ${minField} 0`);
    }

    sorted.forEach((tier, index) => {
      const isLast = index === sorted.length - 1;
      const min = getMin(tier)!;
      const max = getMax(tier);

      if (!isLast && max === null) {
        throw new BadRequestException(
          `Only the last tier may be open-ended (without ${maxField})`,
        );
      }
      if (isLast && max !== null) {
        throw new BadRequestException(
          `The last tier must be open-ended (without ${maxField})`,
        );
      }
      if (max !== null && max <= min) {
        throw new BadRequestException(
          `Tier ${maxField} (${max}) must be greater than ${minField} (${min})`,
        );
      }
      if (!isLast) {
        const nextMin = getMin(sorted[index + 1])!;
        if (nextMin !== max) {
          throw new BadRequestException(
            `Tiers must be contiguous: expected the next tier to start at ${max}, ` +
              `but it starts at ${nextMin}`,
          );
        }
      }
    });
  }

  /**
   * Две схеми за един и същ ключ (банка + вид + категория + label) не може да
   * важат едновременно. Различни label-и (бизнес подкатегории) СМЕЯТ да се
   * застъпват във времето — те са отделни продукти, не конкуриращи се условия.
   */
  private async assertNoOverlappingValidity(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    label: string | null,
    validFrom: Date,
    validTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.db.commissionScheme.findFirst({
      where: {
        bankId,
        schemeType,
        loanCategory,
        label, // null съвпада само с null — Prisma сравнява коректно
        ...(excludeId ? { id: { not: excludeId } } : {}),
        // съществуващата свършва след началото на новата…
        OR: [{ validTo: null }, { validTo: { gt: validFrom } }],
        // …и започва преди края на новата
        ...(validTo ? { validFrom: { lt: validTo } } : {}),
      },
    });

    if (overlapping) {
      const labelNote = label ? ` (label "${label}")` : '';
      throw new ConflictException(
        `Another ${schemeType} scheme for ${loanCategory}${labelNote} already covers ` +
          `this period (valid from ${overlapping.validFrom.toISOString().slice(0, 10)})`,
      );
    }
  }
}
