import { z } from 'zod';

/**
 * Client environment validation (one source of truth, strict failure).
 * Vite statically replaces `import.meta.env.VITE_*`, so every key must be
 * referenced literally here.
 */
const envSchema = z.object({
  VITE_API_BASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      'VITE_API_BASE_URL must be an absolute http(s) URL'
    )
    .default('http://localhost:5000'),
  VITE_ENABLE_SMART_SEARCH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  VITE_ENABLE_IMPACT_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Fail loudly and early: a misconfigured build must never ship silently.
  throw new Error(`Invalid frontend environment configuration:\n${details}`);
}

export const env = {
  apiBaseUrl: parsed.data.VITE_API_BASE_URL.replace(/\/+$/, ''),
  enableSmartSearch: parsed.data.VITE_ENABLE_SMART_SEARCH,
  enableImpactMode: parsed.data.VITE_ENABLE_IMPACT_MODE,
} as const;

/** Absolute API root, e.g. `http://localhost:5000/api/v1`. */
export const apiRoot = `${env.apiBaseUrl}/api/v1`;
