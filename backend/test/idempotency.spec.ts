import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestContext } from '../src/common/request-context';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import { createOrg, createTestApp, createUser, ownerDb, resetDb, type TestApp } from './helpers';

let t: TestApp;
let db: Client;
let idem: IdempotencyService;
let ctx: RequestContext;

/** A stand-in for a financial write: adds a tax rate, so the effect is countable in the database. */
const effect = (name: string) => async (tx: Parameters<Parameters<IdempotencyService['execute']>[3]>[0]) => {
  const row = await tx.taxRate.create({ data: { organizationId: ctx.organizationId, name, rateBp: 0 } });
  return { id: row.id, name: row.name, amountMinor: 12345n };
};
const count = async () => (await db.query(`SELECT count(*)::int AS n FROM tax_rates WHERE rate_bp = 0`)).rows[0].n as number;
const request = (key: string | undefined, body: unknown = { a: 1, b: 2 }) => ({ key, method: 'POST', path: '/x', body });

beforeAll(async () => {
  t = await createTestApp();
  db = await ownerDb();
  idem = t.app.get(IdempotencyService);
});
afterAll(async () => {
  await t.close();
  await db.end();
});
beforeEach(async () => {
  await resetDb(db);
  const org = await createOrg(db);
  const user = await createUser(db, org, 'MANAGER');
  ctx = {
    userId: user.userId,
    organizationId: org.id,
    memberId: user.memberId,
    role: 'MANAGER',
    branchId: null,
    familyId: randomUUID(),
    requestId: 'req_test',
    ip: null,
    userAgent: null,
  };
});

describe('idempotent execution', () => {
  it('runs the operation once and replays the identical response', async () => {
    const key = randomUUID();
    const first = await idem.execute(ctx, request(key), 201, effect('once'));
    const second = await idem.execute(ctx, request(key), 201, effect('once'));
    expect(first).toMatchObject({ status: 201, replayed: false });
    expect(second).toMatchObject({ status: 201, replayed: true });
    expect(second.body).toEqual(first.body);
    expect(first.body).toMatchObject({ name: 'once', amountMinor: 12345 });
    expect(await count()).toBe(1);
  });

  it('treats a body with the same content in a different key order as the same request', async () => {
    const key = randomUUID();
    await idem.execute(ctx, request(key, { a: 1, b: { c: 2, d: 3 } }), 201, effect('order'));
    const replay = await idem.execute(ctx, request(key, { b: { d: 3, c: 2 }, a: 1 }), 201, effect('order'));
    expect(replay.replayed).toBe(true);
    expect(await count()).toBe(1);
  });

  it('applies the effect exactly once when the same request is sent 5 times at the same moment', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => idem.execute(ctx, request(key), 201, effect('race'))));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await count()).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = randomUUID();
    await idem.execute(ctx, request(key, { amount: 100 }), 201, effect('first'));
    await expect(idem.execute(ctx, request(key, { amount: 999 }), 201, effect('second'))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    });
    expect(await count()).toBe(1);
  });

  it('requires a UUID key', async () => {
    for (const key of [undefined, '', 'not-a-uuid']) {
      await expect(idem.execute(ctx, request(key), 201, effect('nokey'))).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        status: 400,
      });
    }
    expect(await count()).toBe(0);
  });

  it('stores nothing when the operation fails, so a retry executes normally', async () => {
    const key = randomUUID();
    await expect(
      idem.execute(ctx, request(key), 201, async (tx) => {
        await effect('doomed')(tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await count()).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM idempotency_keys')).rows[0].n).toBe(0);

    const retry = await idem.execute(ctx, request(key), 201, effect('retry'));
    expect(retry.replayed).toBe(false);
    expect(await count()).toBe(1);
  });

  it('scopes keys to the organization', async () => {
    const key = randomUUID();
    await idem.execute(ctx, request(key), 201, effect('org-a'));
    const otherOrg = await createOrg(db, 'Other');
    const otherUser = await createUser(db, otherOrg, 'MANAGER');
    const otherCtx = { ...ctx, organizationId: otherOrg.id, userId: otherUser.userId, memberId: otherUser.memberId };
    const res = await idem.execute(otherCtx, request(key), 201, async (tx) => {
      const row = await tx.taxRate.create({ data: { organizationId: otherOrg.id, name: 'org-b', rateBp: 0 } });
      return { id: row.id };
    });
    expect(res.replayed).toBe(false);
    expect(await count()).toBe(2);
  });
});
