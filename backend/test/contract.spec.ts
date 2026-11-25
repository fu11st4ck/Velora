import { describe, expect, it } from 'vitest';
import { checkResponse } from './contract';

const json = 'application/json; charset=utf-8';
const product = {
  id: '01a1e824-adb3-72d3-828f-2423dea2382e', sku: 'R-1', barcode: null, name: 'Ring', description: null, weight: null, imageUrl: null,
  quantity: 3, stockStatus: 'LOW', reorderLevel: null, effectiveReorderLevel: 8,
  listPriceMinor: 130000, floorPriceMinor: 115000, ceilingPriceMinor: 160000,
  isActive: true, archivedAt: null, version: 1, createdAt: '2026-11-25T08:00:00.000Z', updatedAt: '2026-11-25T08:00:00.000Z',
};
const body = (data: unknown) => JSON.stringify({ data });

describe('contract checker', () => {
  it('accepts a response that matches openapi.yaml', () => {
    expect(checkResponse('GET', `/api/v1/products/${product.id}`, 200, json, body(product))).toEqual([]);
  });

  it('reports a wrong type, a missing required field and an undocumented field', () => {
    const { sku: _sku, ...missing } = product;
    const problems = checkResponse('GET', `/api/v1/products/${product.id}`, 200, json, body({ ...missing, quantity: 'three', secret: 1 }));
    expect(problems.map((p) => p.problem)).toEqual(
      expect.arrayContaining([expect.stringContaining("required property 'sku'"), '/data/quantity must be integer', 'undocumented field .data.secret']),
    );
  });

  it('reports undocumented routes and statuses, and checks the error envelope of generic errors', () => {
    expect(checkResponse('GET', '/api/v1/nowhere', 200, json, '{}')[0]!.problem).toBe('route not documented');
    expect(checkResponse('GET', '/api/v1/products', 418, json, '{}')[0]!.problem).toContain('status 418 not documented');
    const error = { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'req_1' } };
    expect(checkResponse('GET', '/api/v1/products', 403, json, JSON.stringify(error))).toEqual([]);
    expect(checkResponse('GET', '/api/v1/products', 403, json, '{"message":"no"}')).not.toEqual([]);
  });
});
