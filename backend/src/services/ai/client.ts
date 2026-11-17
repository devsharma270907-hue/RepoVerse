import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { AppError } from '../../utils/appError';
import { logger } from '../../utils/logger';
import { ZodType } from 'zod';

/**
 * Thin, typed wrapper around the Anthropic SDK (PRD §10.3).
 *
 * - AI is optional: without ANTHROPIC_API_KEY the app boots fine and AI
 *   endpoints answer 503 AI_NOT_CONFIGURED.
 * - Structured outputs only: every response is JSON-parsed and Zod-validated
 *   (PRD §10.3 — "Output Zod-validated"). Invalid model output is a 502,
 *   never silently trusted.
 * - Retry/backoff is handled by the SDK (`maxRetries`).
 */

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export interface AiUsageTokens {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredAiResult<T> {
  data: T;
  model: string;
  usage: AiUsageTokens;
}

function getClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'AI features are not configured on this server'
    );
  }
  client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 60_000,
  });
  return client;
}

/** Pull the first JSON object out of a model response (tolerates prose/fences). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fence / brace recovery
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  return undefined;
}

/**
 * One grounded, Zod-validated Claude call. The prompt must instruct the
 * model to answer with a single JSON object matching the schema.
 */
export async function callClaudeStructured<T>(opts: {
  system: string;
  prompt: string;
  maxTokens: number;
  schema: ZodType<T>;
}): Promise<StructuredAiResult<T>> {
  const anthropic = getClient();
  try {
    const message = await anthropic.messages.create({
      model: env.AI_MODEL_DEFAULT,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
    });

    const usage: AiUsageTokens = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    };

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = opts.schema.safeParse(extractJson(text));
    if (!parsed.success) {
      logger.warn('AI response failed schema validation', {
        model: message.model,
      });
      throw new AppError(
        502,
        'AI_INVALID_RESPONSE',
        'The AI returned an unexpected format — please retry'
      );
    }

    return {
      data: parsed.data,
      model: message.model ?? env.AI_MODEL_DEFAULT,
      usage,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn(
      'Claude call failed',
      err instanceof Error ? err : new Error(String(err))
    );
    throw new AppError(
      502,
      'AI_PROVIDER_ERROR',
      'The AI provider is temporarily unavailable — please retry'
    );
  }
}
