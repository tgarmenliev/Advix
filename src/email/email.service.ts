import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailResult {
  id: string;
  /** true = реално изпратено; false = dry-run (нищо не е напуснало машината) */
  delivered: boolean;
  dryRun: boolean;
}

const PLACEHOLDER_KEYS = new Set(['', 'change-me']);

/**
 * Изпращане на имейл с безопасен режим по подразбиране.
 *
 * Ако няма реален ключ или EMAIL_DRY_RUN не е изрично `false`, услугата работи в
 * **dry-run**: логва писмото и връща синтетичен резултат, но НЕ праща нищо навън.
 * Реалното изпращане през Resend се активира само при реален ключ и
 * EMAIL_DRY_RUN=false — така по време на разработка не се пращат имейли до
 * реални банкови служители по случайност.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    const apiKey = this.configService.get<string>('email.apiKey') ?? '';
    const from = this.configService.get<string>('email.from') ?? '';
    const dryRun = this.configService.get<boolean>('email.dryRun') ?? true;
    const hasRealKey = !PLACEHOLDER_KEYS.has(apiKey);

    if (dryRun || !hasRealKey) {
      this.logger.log(
        `[DRY-RUN] Имейл до ${message.to} — тема: "${message.subject}" (не е изпратен реално)`,
      );
      return { id: `dry-run-${randomUUID()}`, delivered: false, dryRun: true };
    }

    return this.sendViaResend(message, apiKey, from);
  }

  /** Реално изпращане през Resend HTTP API (глобален fetch). */
  private async sendViaResend(
    message: EmailMessage,
    apiKey: string,
    from: string,
  ): Promise<EmailResult> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.body,
        }),
      });
    } catch (error) {
      this.logger.error(
        'Resend request failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Email provider is unreachable');
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Resend returned ${response.status}: ${detail}`);
      throw new ServiceUnavailableException('Email provider rejected the message');
    }

    const data = (await response.json()) as { id?: string };
    return { id: data.id ?? randomUUID(), delivered: true, dryRun: false };
  }
}
