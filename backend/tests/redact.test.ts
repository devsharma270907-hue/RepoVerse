import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  redactSecretsDetailed,
} from '../src/utils/redactSecrets';

/**
 * AI prompt secret redaction (PRD §10.3). Pure unit tests — no DB, no network.
 */
describe('secret redaction', () => {
  it('redacts provider keys, AWS keys, GitHub tokens and JWTs', () => {
    const source = [
      'const key = "sk-ant-abcdefghijklmnopqrstuvwx";',
      'const aws = "AKIAABCDEFGHIJKLMNOP";',
      'const gh = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
      'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature1234567890";',
    ].join('\n');

    const out = redactSecrets(source);
    expect(out).not.toContain('sk-ant-abcdefghijklmnop');
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out).not.toContain('ghp_aaaaaaaa');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[REDACTED:API_KEY]');
    expect(out).toContain('[REDACTED:AWS_KEY]');
    expect(out).toContain('[REDACTED:GITHUB_TOKEN]');
    expect(out).toContain('[REDACTED:JWT]');
  });

  it('redacts assignment-style secrets but keeps the identifier', () => {
    const out = redactSecrets('const dbPassword = "hunter2secret";');
    expect(out).toContain('dbPassword');
    expect(out).not.toContain('hunter2secret');
    expect(out).toContain('[REDACTED:SECRET]');
  });

  it('redacts connection-string credentials and bearer tokens', () => {
    const out = redactSecrets(
      'mongodb://admin:hunter2@db.example.com/app\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz'
    );
    expect(out).not.toContain('admin:hunter2');
    expect(out).toContain('mongodb://[REDACTED:CONNECTION_STRING]@db.example.com');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('Bearer [REDACTED:BEARER_TOKEN]');
  });

  it('redacts private key blocks', () => {
    const out = redactSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    );
    expect(out).toBe('[REDACTED:PRIVATE_KEY]');
  });

  it('leaves ordinary code untouched and reports zero redactions', () => {
    const code =
      'const total = items.reduce((sum, item) => sum + item.price, 0);';
    const result = redactSecretsDetailed(code);
    expect(result.text).toBe(code);
    expect(result.redactions).toBe(0);
  });

  it('counts multiple redactions', () => {
    const result = redactSecretsDetailed(
      'AKIAABCDEFGHIJKLMNOP and ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(result.redactions).toBe(2);
  });
});
