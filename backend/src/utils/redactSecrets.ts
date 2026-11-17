/**
 * Best-effort secret redaction for source code sent to the LLM (PRD §10.3).
 *
 * Analyzed repositories are untrusted input: they can contain live
 * credentials, and whatever we send to a third-party model leaves our
 * boundary. This runs BEFORE content is placed in a prompt and replaces
 * recognizable secrets with `[REDACTED:<kind>]` while keeping enough
 * structure for the model to explain the surrounding code.
 *
 * This is defense-in-depth, not a guarantee — pattern matching cannot catch
 * every secret. The pipeline never persists source code (PRD §10.5), and AI
 * endpoints only fetch the one symbol's file on demand.
 */

const PLACEHOLDERS = {
  privateKey: '[REDACTED:PRIVATE_KEY]',
  jwt: '[REDACTED:JWT]',
  aws: '[REDACTED:AWS_KEY]',
  github: '[REDACTED:GITHUB_TOKEN]',
  provider: '[REDACTED:API_KEY]',
  bearer: '[REDACTED:BEARER_TOKEN]',
  connection: '[REDACTED:CONNECTION_STRING]',
  assignment: '[REDACTED:SECRET]',
} as const;

const RULES: Array<{
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...args: any[]) => string);
}> = [
  {
    name: 'private key block',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    replacement: PLACEHOLDERS.privateKey,
  },
  {
    name: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: PLACEHOLDERS.aws,
  },
  {
    name: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: PLACEHOLDERS.github,
  },
  {
    name: 'Anthropic/OpenAI key',
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g,
    replacement: PLACEHOLDERS.provider,
  },
  {
    name: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: PLACEHOLDERS.jwt,
  },
  {
    // URL with embedded credentials: scheme://user:pass@host
    name: 'connection string credentials',
    pattern:
      /\b((?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replacement: (_match: string, scheme: string) =>
      `${scheme}${PLACEHOLDERS.connection}@`,
  },
  {
    // Authorization: Bearer <token> (header literals in code/tests)
    name: 'bearer token',
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g,
    replacement: (_match: string, scheme: string) =>
      `${scheme} ${PLACEHOLDERS.bearer}`,
  },
  {
    // key/secret/password/token assignments, quoted or unquoted values.
    // Keeps the identifier so the model still understands intent.
    name: 'secret assignment',
    pattern:
      /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key)[A-Za-z0-9_.-]*)\s*[:=]\s*(['"`])([^'"`\r\n]{6,})\2/gi,
    replacement: (_match: string, key: string, quote: string) =>
      `${key}: ${quote}${PLACEHOLDERS.assignment}${quote}`,
  },
];

export interface RedactionResult {
  text: string;
  redactions: number;
}

/** Replaces recognizable secrets with typed placeholders. */
export function redactSecretsDetailed(input: string): RedactionResult {
  let output = input;
  let redactions = 0;

  for (const rule of RULES) {
    output = output.replace(rule.pattern, (...args: any[]) => {
      redactions++;
      if (typeof rule.replacement === 'function') {
        return (rule.replacement as (...a: any[]) => string)(...args);
      }
      return rule.replacement;
    });
  }

  return { text: output, redactions };
}

/** Convenience wrapper returning only the redacted text. */
export function redactSecrets(input: string): string {
  return redactSecretsDetailed(input).text;
}
