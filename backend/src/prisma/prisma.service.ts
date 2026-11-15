import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

const RETRYABLE = new Set(['P2034', '40001', '40P01']);

/**
 * Database access. Tenant data is reachable only through `tenantTx`, which pins the transaction to one
 * organization for PostgreSQL row-level security (docs/database-design.md §3).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Runs `fn` in a transaction scoped to one organization. Retries deadlocks and serialization failures. */
  tenantTx<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withRetry(() =>
      this.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
        return fn(tx);
      }),
    );
  }

  /**
   * Runs `fn` in a transaction that can see only the given user's own memberships.
   * Used during sign-in, before an organization has been selected.
   */
  userTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withRetry(() =>
      this.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        return fn(tx);
      }),
    );
  }

  private async withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (e) {
        const code = (e as { code?: string; meta?: { code?: string } }).code ?? '';
        const dbCode = (e as { meta?: { code?: string } }).meta?.code ?? '';
        if (attempt >= attempts || !(RETRYABLE.has(code) || RETRYABLE.has(dbCode))) throw e;
        await new Promise((r) => setTimeout(r, 20 * attempt));
      }
    }
  }
}
