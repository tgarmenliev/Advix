import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankContact,
  Client,
  InquiryStatus,
  LoanApplication,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from '../email/email.service';
import { fillPlaceholders } from '../inquiry-templates/placeholder.util';
import { InquiryTemplatesService } from '../inquiry-templates/inquiry-templates.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { SendInquiriesDto } from './dto/send-inquiries.dto';

@Injectable()
export class BankInquiriesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly inquiryTemplatesService: InquiryTemplatesService,
    private readonly emailService: EmailService,
    private readonly loanApplicationsService: LoanApplicationsService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /** Попълва темата и тялото на default шаблона с данните на заявката (за преглед). */
  async preview(applicationId: string, currentUser: AuthenticatedUser) {
    await this.loanApplicationsService.assertAccessById(applicationId, currentUser);
    const { application, client } = await this.loadApplication(applicationId);
    const template = await this.inquiryTemplatesService.getDefault();
    const vars = this.buildVars(application, client);
    return {
      subject: fillPlaceholders(template.subject, vars),
      body: fillPlaceholders(template.body, vars),
      templateId: template.id,
    };
  }

  /**
   * Изпраща запитвания към избраните банкови контакти:
   *  1. Прилага правилата по роля и придвижва заявката към SENT_TO_BANKS.
   *  2. За всеки контакт запечатва изпратения текст (snapshot) и праща имейл
   *     (в dry-run по подразбиране — нищо не напуска машината).
   */
  async send(
    applicationId: string,
    dto: SendInquiriesDto,
    currentUser: AuthenticatedUser,
  ) {
    // Роля + собственост + преход READY_FOR_BANK → SENT_TO_BANKS
    await this.loanApplicationsService.markSentToBanks(applicationId, currentUser);

    const { application, client } = await this.loadApplication(applicationId);

    const contacts = await this.db.bankContact.findMany({
      where: { id: { in: dto.bankContactIds } },
      include: { bank: true },
    });
    if (contacts.length !== dto.bankContactIds.length) {
      throw new BadRequestException('One or more bank contacts were not found');
    }

    // Ако консултантът не е подал редактиран текст, взимаме default шаблона
    let subject = dto.subject;
    let body = dto.body;
    if (subject === undefined || body === undefined) {
      const template = await this.inquiryTemplatesService.getDefault();
      subject = subject ?? template.subject;
      body = body ?? template.body;
    }

    const results: Array<{
      inquiryId: string;
      bank: string;
      to: string;
      delivered: boolean;
      dryRun: boolean;
    }> = [];

    for (const contact of contacts) {
      const vars = this.buildVars(application, client, contact);
      const renderedSubject = fillPlaceholders(subject, vars);
      const renderedBody = fillPlaceholders(body, vars);

      // Snapshot: пазим точно какво е заминало, дори шаблонът да се смени после
      const inquiry = await this.db.bankInquiry.create({
        data: {
          loanApplicationId: applicationId,
          bankId: contact.bankId,
          bankContactId: contact.id,
          sentAt: new Date(),
          sentContent: renderedBody,
          consultantNote: dto.consultantNote,
          status: InquiryStatus.SENT,
        },
      });

      let delivered = false;
      let dryRun = true;
      try {
        const emailResult = await this.emailService.send({
          to: contact.email,
          subject: renderedSubject,
          body: renderedBody,
        });
        delivered = emailResult.delivered;
        dryRun = emailResult.dryRun;
      } catch {
        // Запитването е записано (snapshot); доставката е best-effort
        delivered = false;
        dryRun = false;
      }

      results.push({
        inquiryId: inquiry.id,
        bank: contact.bank.name,
        to: contact.email,
        delivered,
        dryRun,
      });
    }

    return { sent: results.length, results };
  }

  async listForApplication(
    applicationId: string,
    currentUser: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(applicationId, currentUser);
    return this.db.bankInquiry.findMany({
      where: { loanApplicationId: applicationId },
      include: {
        bank: { select: { id: true, name: true } },
        bankContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    status: InquiryStatus,
    currentUser: AuthenticatedUser,
  ) {
    const inquiry = await this.db.bankInquiry.findUnique({ where: { id } });
    if (!inquiry) {
      throw new NotFoundException('Bank inquiry not found');
    }
    await this.loanApplicationsService.assertAccessById(
      inquiry.loanApplicationId,
      currentUser,
    );
    return this.db.bankInquiry.update({ where: { id }, data: { status } });
  }

  private async loadApplication(applicationId: string): Promise<{
    application: LoanApplication;
    client: Client;
  }> {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
      include: { client: true },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    return { application, client: application.client };
  }

  /** Стойностите за placeholder-ите в шаблона. */
  private buildVars(
    application: LoanApplication,
    client: Client,
    contact?: BankContact & { bank: { name: string } },
  ): Record<string, string> {
    return {
      clientName: `${client.firstName} ${client.lastName ?? ''}`.trim(),
      // amount е в стотинки (евроцентове) → показваме като цяла валута
      amount: (application.amount / 100).toFixed(2),
      loanType: application.loanType,
      termMonths: application.termMonths ? String(application.termMonths) : '',
      purpose: application.purpose ?? '',
      bankName: contact?.bank.name ?? '',
      contactName: contact ? `${contact.firstName} ${contact.lastName}` : '',
    };
  }
}
