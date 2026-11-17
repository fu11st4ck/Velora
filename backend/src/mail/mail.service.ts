import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../common/config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** Sends transactional email over SMTP. Without SMTP configured (local development) it only logs that a mail was due. */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = config.MAIL_SMTP_URL ? createTransport(config.MAIL_SMTP_URL) : null;
  }

  /**
   * Returns whether the mail was handed to the mail server. Never throws: what triggered the mail
   * (an invitation, a reset request) has already been saved, and failing the request would only
   * hide that from the caller.
   */
  async send(mail: OutgoingMail): Promise<boolean> {
    if (!this.transport) {
      // The body may contain a reset link, so it is never logged.
      this.logger.warn(`SMTP not configured — mail "${mail.subject}" not sent`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.config.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
      return true;
    } catch (error) {
      this.logger.error(`Mail "${mail.subject}" could not be sent: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }
}
