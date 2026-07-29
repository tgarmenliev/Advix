import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateInquiryTemplateDto } from './dto/create-inquiry-template.dto';
import { UpdateInquiryTemplateDto } from './dto/update-inquiry-template.dto';
import { InquiryTemplatesService } from './inquiry-templates.service';

// Управлението на шаблони е само за ADMIN; четенето — и за тези, които изпращат
// запитвания (за да заредят/прегледат default шаблона).
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller('inquiry-templates')
export class InquiryTemplatesController {
  constructor(
    private readonly inquiryTemplatesService: InquiryTemplatesService,
  ) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateInquiryTemplateDto) {
    return this.inquiryTemplatesService.create(dto);
  }

  @Get()
  findAll() {
    return this.inquiryTemplatesService.findAll();
  }

  @Get('default')
  getDefault() {
    return this.inquiryTemplatesService.getDefault();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.inquiryTemplatesService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInquiryTemplateDto,
  ) {
    return this.inquiryTemplatesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.inquiryTemplatesService.remove(id);
  }
}
