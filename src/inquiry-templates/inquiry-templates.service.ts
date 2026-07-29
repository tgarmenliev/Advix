import { Injectable, NotFoundException } from '@nestjs/common';
import { InquiryTemplate } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateInquiryTemplateDto } from './dto/create-inquiry-template.dto';
import { UpdateInquiryTemplateDto } from './dto/update-inquiry-template.dto';

@Injectable()
export class InquiryTemplatesService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /** При isDefault=true другите шаблони губят флага — точно един default. */
  async create(dto: CreateInquiryTemplateDto): Promise<InquiryTemplate> {
    return this.db.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.inquiryTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.inquiryTemplate.create({ data: dto });
    });
  }

  findAll(): Promise<InquiryTemplate[]> {
    return this.db.inquiryTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string): Promise<InquiryTemplate> {
    const template = await this.db.inquiryTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Inquiry template not found');
    }
    return template;
  }

  /** Шаблонът по подразбиране — този, който се зарежда при ново запитване. */
  async getDefault(): Promise<InquiryTemplate> {
    const template = await this.db.inquiryTemplate.findFirst({
      where: { isDefault: true },
    });
    if (!template) {
      throw new NotFoundException(
        'No default inquiry template configured for this organization',
      );
    }
    return template;
  }

  async update(
    id: string,
    dto: UpdateInquiryTemplateDto,
  ): Promise<InquiryTemplate> {
    await this.findOne(id);
    return this.db.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.inquiryTemplate.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.inquiryTemplate.update({ where: { id }, data: dto });
    });
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.findOne(id);
    await this.db.inquiryTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }
}
