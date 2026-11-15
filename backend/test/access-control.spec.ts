import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ACCESS_KEY, type AccessRule } from '../src/authz/decorators';
import { canSeeCost, hasPermission, PERMISSIONS, permissionsFor } from '../src/authz/permissions';

describe('role permissions (business rules §9)', () => {
  it('gives the sales role exactly its selling permissions', () => {
    expect(permissionsFor('SALES')).toEqual(
      [
        'customer.read',
        'customer.write',
        'document.read_own',
        'inventory.read',
        'payment.record',
        'product.read',
        'report.read_own',
        'sale.create',
      ].sort(),
    );
  });

  it('keeps cost, stock changes, reversals and configuration away from sales', () => {
    for (const p of [
      'product.read_cost',
      'product.manage',
      'inventory.manage',
      'sale.below_minimum',
      'document.read_all',
      'payment.refund',
      'invoice.cancel',
      'invoice.return',
      'report.read_all',
      'settings.manage',
      'team.manage',
    ] as const) {
      expect(hasPermission('SALES', p), p).toBe(false);
    }
    expect(canSeeCost('SALES')).toBe(false);
    expect(canSeeCost('MANAGER')).toBe(true);
  });

  it('makes each role a superset of the one below, with settings and team reserved for the owner', () => {
    for (const p of permissionsFor('SALES')) expect(hasPermission('MANAGER', p)).toBe(true);
    for (const p of permissionsFor('MANAGER')) expect(hasPermission('OWNER', p)).toBe(true);
    expect(hasPermission('MANAGER', 'settings.manage')).toBe(false);
    expect(hasPermission('MANAGER', 'team.manage')).toBe(false);
    expect(permissionsFor('OWNER')).toHaveLength(PERMISSIONS.length);
  });
});

describe('route access rules', () => {
  it('every route declares an access rule, and only the intended routes are public', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, { module: class {}, providers: [DiscoveryService, MetadataScanner] }] }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    const routes: { name: string; rule: AccessRule | undefined }[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const method of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[method] as () => unknown;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes.push({
          name: `${wrapper.name}.${method}`,
          rule: reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [handler, instance.constructor]),
        });
      }
    }
    await moduleRef.close();

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !r.rule).map((r) => r.name)).toEqual([]);
    expect(routes.filter((r) => r.rule?.kind === 'public').map((r) => r.name).sort()).toEqual([
      'AuthController.forgotPassword',
      'AuthController.login',
      'AuthController.refresh',
      'AuthController.resetPassword',
      'HealthController.live',
      'HealthController.ready',
    ]);
  });
});
