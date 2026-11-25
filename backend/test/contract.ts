/**
 * Checks every response the test suite receives against backend/openapi/openapi.yaml, so the
 * contract the web and mobile apps rely on cannot drift from what the server really sends.
 *
 * For each JSON response it checks that the route, method and status are documented, that the
 * body matches the documented schema, and that the body has no fields the schema does not
 * declare (an undocumented field would be missing from the generated web types).
 */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

type Schema = Record<string, unknown>;
interface Spec {
  paths: Record<string, Record<string, { responses?: Record<string, Schema> }>>;
  components: Record<string, Record<string, Schema>>;
}

const PREFIX = '/api/v1';
const spec = load(readFileSync(join(__dirname, '..', 'openapi', 'openapi.yaml'), 'utf8')) as Spec;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec as unknown as Schema, 'openapi');

const routes = Object.keys(spec.paths).map((path) => ({
  path,
  pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
  // Literal segments win over parameters (`/inventory/history` before `/inventory/{id}`).
  literal: path.replace(/\{[^}]+\}/g, '').length,
}));
routes.sort((a, b) => b.literal - a.literal);

const pointer = (...parts: string[]) => parts.map((p) => p.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const compiled = new Map<string, ValidateFunction>();

function resolve(schema: Schema | undefined): Schema | undefined {
  let s = schema;
  for (let i = 0; s && typeof s.$ref === 'string' && i < 10; i++) {
    const parts = (s.$ref as string).replace(/^#\//, '').split('/').map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
    s = parts.reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], spec) as Schema | undefined;
  }
  return s;
}

/** Fields present in `data` that `schema` does not declare, as dotted paths. */
function undeclared(data: unknown, schema: Schema | undefined, at: string): string[] {
  const s = resolve(schema);
  if (!s || data === null || typeof data !== 'object') return [];
  const branches = (['allOf', 'anyOf', 'oneOf'] as const).flatMap((k) => (Array.isArray(s[k]) ? (s[k] as Schema[]) : []));
  if (Array.isArray(data)) {
    const items = s.items as Schema | undefined;
    return items || branches.length ? data.flatMap((d, i) => undeclared(d, items ?? { anyOf: branches }, `${at}[${i}]`)) : [];
  }
  // Collect declared properties through composition.
  const props = new Map<string, Schema[]>();
  let open = s.additionalProperties !== undefined && s.additionalProperties !== false;
  const visit = (node: Schema | undefined) => {
    const n = resolve(node);
    if (!n) return;
    for (const [k, v] of Object.entries((n.properties as Record<string, Schema>) ?? {})) props.set(k, [...(props.get(k) ?? []), v]);
    if (n.additionalProperties !== undefined && n.additionalProperties !== false) open = true;
    for (const k of ['allOf', 'anyOf', 'oneOf'] as const) if (Array.isArray(n[k])) (n[k] as Schema[]).forEach(visit);
  };
  visit(s);
  if (props.size === 0 && (open || s.type !== 'object')) return [];
  return Object.entries(data as Record<string, unknown>).flatMap(([key, value]) => {
    const declared = props.get(key);
    if (!declared) return open ? [] : [`${at}.${key}`];
    // A field is fine if at least one declaration accounts for all of its nested fields.
    const results = declared.map((d) => undeclared(value, d, `${at}.${key}`));
    return results.reduce((best, r) => (r.length < best.length ? r : best));
  });
}

const GENERIC_ERRORS = new Set([400, 401, 403, 404, 429, 500, 503]);
let validateError: ValidateFunction | undefined;

function errorEnvelope(request: string, status: number, body: string): Mismatch[] {
  validateError ??= ajv.compile({ $ref: 'openapi#/components/schemas/ErrorEnvelope' });
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [{ request, status, problem: 'error response is not JSON' }];
  }
  return validateError(data) ? [] : (validateError.errors ?? []).map((e) => ({ request, status, problem: `error envelope ${e.instancePath} ${e.message}` }));
}

export interface Mismatch {
  request: string;
  status: number;
  problem: string;
}

export function checkResponse(method: string, url: string, status: number, contentType: string | undefined, body: string): Mismatch[] {
  if (!url.startsWith(PREFIX) || status === 304) return [];
  const path = url.slice(PREFIX.length).split('?')[0]!;
  const request = `${method} ${path}`;
  const route = routes.find((r) => r.pattern.test(path));
  if (!route) return status === 404 ? errorEnvelope(request, status, body) : [{ request, status, problem: 'route not documented' }];
  const operation = spec.paths[route.path]![method.toLowerCase()];
  if (!operation) return [{ request, status, problem: `method not documented for ${route.path}` }];
  const responses = operation.responses ?? {};
  const code = [String(status), `${String(status)[0]}XX`, 'default'].find((c) => c in responses);
  if (!code) {
    // Generic errors apply to every operation (see the description in openapi.yaml).
    if (GENERIC_ERRORS.has(status)) return errorEnvelope(request, status, body);
    return [{ request, status, problem: `status ${status} not documented for ${method} ${route.path}` }];
  }
  const response = resolve(responses[code]) as { content?: Record<string, { schema?: Schema }> } | undefined;
  const isJson = contentType?.startsWith('application/json') ?? false;
  if (!isJson || !body) {
    const types = Object.keys(response?.content ?? {});
    const ok = !body || types.length === 0 || types.some((t) => contentType?.startsWith(t));
    return ok ? [] : [{ request, status, problem: `content type ${contentType} not documented (${types.join(', ')})` }];
  }
  const media = response?.content?.['application/json'];
  if (!media?.schema) return [{ request, status, problem: 'JSON body but no JSON schema documented' }];

  const key = `${route.path} ${method} ${code}`;
  let validate = compiled.get(key);
  if (!validate) {
    const responseRef = typeof (responses[code] as Schema).$ref === 'string' ? ((responses[code] as Schema).$ref as string) : null;
    const base = responseRef ? responseRef.slice(1) : `/${pointer('paths', route.path, method.toLowerCase(), 'responses', code)}`;
    validate = ajv.compile({ $ref: `openapi#${base}/${pointer('content', 'application/json', 'schema')}` });
    compiled.set(key, validate);
  }
  const data = JSON.parse(body) as unknown;
  const problems: Mismatch[] = [];
  if (!validate(data)) {
    for (const e of validate.errors ?? []) problems.push({ request, status, problem: `${e.instancePath || '(body)'} ${e.message}${e.params && 'allowedValues' in e.params ? ` ${JSON.stringify(e.params.allowedValues)}` : ''}` });
  }
  for (const field of undeclared(data, media.schema, '')) problems.push({ request, status, problem: `undocumented field ${field}` });
  return problems;
}

/** Wraps a Fastify-style inject so every response is checked. */
export function withContractChecks<T extends { inject: (...args: never[]) => unknown }>(app: T): void {
  const original = app.inject.bind(app) as (opts: Record<string, unknown>) => Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
  (app as unknown as { inject: unknown }).inject = async (opts: Record<string, unknown>) => {
    const res = await original(opts);
    const method = String(opts.method ?? 'GET').toUpperCase();
    const problems = checkResponse(method, String(opts.url), res.statusCode, res.headers['content-type'] as string | undefined, res.body);
    if (problems.length > 0) {
      const log = process.env.CONTRACT_LOG;
      if (log) appendFileSync(log, problems.map((p) => JSON.stringify(p)).join('\n') + '\n');
      else throw new Error(`Response does not match openapi.yaml:\n${problems.map((p) => `  ${p.request} → ${p.status}: ${p.problem}`).join('\n')}`);
    }
    return res;
  };
}
