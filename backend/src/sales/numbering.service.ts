import { Injectable } from '@nestjs/common';
import type { DocumentType } from '@prisma/client';
import { Clock } from '../common/clock';
import { localDate } from '../common/dates';
import type { RequestContext } from '../common/request-context';
import type { Tx } from '../prisma/prisma.service';

const DEFAULT_PREFIX: Record<DocumentType, string> = { INVOICE: 'INV', QUOTATION: 'QT', CREDIT_NOTE: 'CN' };

/**
 * Document numbers `{PREFIX}-{YYYY}-{NNNNN}` (business rule D1): one sequence per organization,
 * document type and year, where the year is the current year in the organization timezone.
 *
 * The counter row is incremented inside the caller's transaction and stays locked until it ends,
 * so numbers are issued in order with no gaps: a rolled-back document gives its number back.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly clock: Clock) {}

  async next(tx: Tx, ctx: RequestContext, type: DocumentType, timezone: string): Promise<string> {
    const year = Number(localDate(this.clock.now(), timezone).slice(0, 4));
    // A new year continues with the prefix the organization used before.
    const previous = await tx.documentSequence.findFirst({ where: { type }, orderBy: { year: 'desc' }, select: { prefix: true } });
    const prefix = previous?.prefix ?? DEFAULT_PREFIX[type];
    const rows = await tx.$queryRaw<{ prefix: string; lastNumber: number }[]>`
      INSERT INTO document_sequences (id, organization_id, type, year, prefix, last_number)
      VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${type}::"DocumentType", ${year}, ${prefix}, 1)
      ON CONFLICT (organization_id, type, year)
      DO UPDATE SET last_number = document_sequences.last_number + 1
      RETURNING prefix, last_number AS "lastNumber"`;
    const row = rows[0] as { prefix: string; lastNumber: number };
    return `${row.prefix}-${year}-${String(row.lastNumber).padStart(5, '0')}`;
  }
}
