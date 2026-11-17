import { Document, Schema, model } from 'mongoose';

/**
 * Per-call AI token accounting (PRD §10.4) — powers the monthly
 * per-user budget enforced by middleware/aiBudget.ts.
 */
export interface AiUsageDocument extends Document {
  userId: unknown;
  analysisId?: unknown;
  kind: 'explain' | 'search';
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
}

const aiUsageSchema = new Schema<AiUsageDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', index: true },
    kind: { type: String, required: true, enum: ['explain', 'search'] },
    modelVersion: { type: String, required: true },
    inputTokens: { type: Number, required: true, min: 0 },
    outputTokens: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Month-window budget aggregates filter on userId + createdAt
aiUsageSchema.index({ userId: 1, createdAt: -1 });

export const AiUsage = model<AiUsageDocument>('AiUsage', aiUsageSchema);
