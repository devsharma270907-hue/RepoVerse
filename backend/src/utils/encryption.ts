import crypto from 'crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM for third-party tokens at rest (blueprint Section 6).
 * A unique 12-byte IV per encryption; the auth tag is stored alongside the
 * ciphertext so tampering is detected on decrypt (setAuthTag + final throws).
 *
 * Stored shape is three base64 strings — the key itself lives ONLY in env.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce length

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 auth tag
}

function keyBuffer(keyHex: string = env.ENCRYPTION_KEY): Buffer {
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext: string, keyHex?: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(keyHex), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(payload: EncryptedPayload, keyHex?: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyBuffer(keyHex),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
