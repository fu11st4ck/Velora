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

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) {
      // The body may contain a reset link, so it is never logged.
      this.logger.warn(`SMTP not configured — mail "${mail.subject}" not sent`);
      return;
    }
    await this.transport.sendMail({ from: this.config.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
