import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Property } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  create(dto: CreatePropertyDto): Promise<Property> {
    return this.db.property.create({ data: dto });
  }

  async findOne(id: string): Promise<Property> {
    const property = await this.db.property.findUnique({
      where: { id },
      include: {
        loanApplications: {
          select: {
            loanApplicationId: true,
            marketValue: true,
            mortgageBankId: true,
            assignedAt: true,
          },
        },
      },
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  async update(id: string, dto: UpdatePropertyDto): Promise<Property> {
    const existing = await this.db.property.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Property not found');
    }
    return this.db.property.update({ where: { id }, data: dto });
  }

  /**
   * Политика при изтриване (документирано решение): изтриването се БЛОКИРА,
   * ако имотът е свързан към заявка. Връзката носи бизнес данни (marketValue,
   * mortgageBankId) и не бива да изчезва мълчаливо — първо се премахва връзката
   * през DELETE /loan-applications/:id/properties/:propertyId, после имотът.
   */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.db.property.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Property not found');
    }

    const linkCount = await this.db.loanApplicationProperty.count({
      where: { propertyId: id },
    });
    if (linkCount > 0) {
      throw new ConflictException(
        `Property is linked to ${linkCount} loan application(s) — unlink it first`,
      );
    }

    await this.db.property.delete({ where: { id } });
    return { id, deleted: true };
  }
}
