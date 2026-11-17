import { Document, Schema, model } from 'mongoose';

export interface RefreshTokenEntry {
  tokenHash: string; // bcrypt hash of the refresh JWT — never the raw token
  sessionId: string; // stable id across rotations — powers session management
  expiresAt: Date;
  used: boolean; // rotation marker — a `used` token replayed = breach signal
  createdAt: Date;
  lastUsedAt?: Date; // updated when the token is rotated
  userAgent?: string; // display-only session metadata
}

export interface GithubTokenEntry {
  ciphertext: string; // AES-256-GCM — the raw PAT is never stored
  iv: string;
  tag: string;
  hint: string; // e.g. `••••a1b2` for UI display only
  scopes: string[]; // scopes GitHub reported at save time (may be empty)
  updatedAt: Date;
}

export interface UserDocument extends Document {
  name: string;
  email: string;
  passwordHash?: string; // absent for OAuth-only accounts
  googleId?: string;
  githubToken?: GithubTokenEntry; // encrypted PAT for private repos (select: false)
  refreshTokens: RefreshTokenEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenEntry>(
  {
    tokenHash: { type: String, required: true },
    sessionId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
    lastUsedAt: { type: Date },
    userAgent: { type: String },
  },
  { _id: false }
);

const githubTokenSchema = new Schema<GithubTokenEntry>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    hint: { type: String, required: true },
    scopes: { type: [String], default: [] },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String },
    googleId: { type: String, index: true },
    // Encrypted PAT — excluded from every query unless explicitly selected
    githubToken: { type: githubTokenSchema, select: false },
    refreshTokens: { type: [refreshTokenSchema], default: [] },
  },
  { timestamps: true }
);

export const User = model<UserDocument>('User', userSchema);
