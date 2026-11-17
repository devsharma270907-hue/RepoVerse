import { Document, Schema, model } from 'mongoose';

/**
 * Failed-login tracker (blueprint security checklist: lockout after 5
 * attempts for 15 minutes). One document per normalized email — including
 * emails that do not exist, so lockout behavior reveals nothing about
 * account existence. The TTL index erases stale counters automatically.
 */
export interface LoginAttemptDocument extends Document {
  email: string;
  count: number;
  expiresAt: Date;
  lastAttemptAt: Date;
}

const loginAttemptSchema = new Schema<LoginAttemptDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// TTL: the lockout window is enforced by expiresAt on every check; Mongo
// removes the document once the window has passed.
loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = model<LoginAttemptDocument>(
  'LoginAttempt',
  loginAttemptSchema
);
