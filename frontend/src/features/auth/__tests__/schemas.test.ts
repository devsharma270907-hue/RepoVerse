import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '@/features/auth/schemas';

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    expect(
      loginSchema.safeParse({ email: 'ada@example.com', password: 'secret' }).success
    ).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
  });

  it('requires a password', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'correct-horse',
    confirmPassword: 'correct-horse',
  };

  it('accepts matching passwords', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(
      registerSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' })
        .success
    ).toBe(false);
  });

  it('rejects mismatched passwords with a field-level error', () => {
    const result = registerSchema.safeParse({
      ...valid,
      confirmPassword: 'different',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });

  it('trims the name', () => {
    const result = registerSchema.safeParse({ ...valid, name: '  Ada  ' });
    expect(result.success && result.data.name).toBe('Ada');
  });
});
