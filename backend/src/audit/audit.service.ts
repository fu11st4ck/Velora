import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Writes audit entries with the caller's transaction client, so a change and its audit record
 * commit or roll back together. Never pass secrets (passwords, tokens) in before/after.
 */
@Injectable()
export class AuditService {
  async record(db: Tx, entry: AuditEntry): Promise<void> {
    // createMany issues a plain INSERT (no RETURNING), which row-level security allows for
    // pre-tenant auth events that the application role may write but not read back.
    await db.auditLog.createMany({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        ipAddress: entry.ip ?? undefined,
        userAgent: entry.userAgent ?? undefined,
        requestId: entry.requestId ?? undefined,
      },
    });
  }
}
