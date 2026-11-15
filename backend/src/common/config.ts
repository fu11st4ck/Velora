import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_KEY_ID: z.string().min(1).default('dev'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    MAIL_SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Velora <no-reply@example.com>'),
    MOBILE_DEEP_LINK_BASE: z.string().default('velora://'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().min(1).default(20),
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    // Ephemeral signing keys are acceptable only outside production.
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'MAIL_SMTP_URL'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
      }
    }
  });

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Validates the environment once at start-up; the process must not start with a bad configuration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const normalised = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = schema.safeParse(normalised);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${problems}`);
  }
  return parsed.data;
}
