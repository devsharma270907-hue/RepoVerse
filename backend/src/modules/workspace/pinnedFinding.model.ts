import { Document, Schema, model } from 'mongoose';

/**
 * Pinned finding (PRD Phase 3 — persistent workspace state).
 * Pins a graph node of a completed analysis with an optional note, so a team
 * member can return to the same risk/cycle/symbol later.
 */

export interface PinnedFindingDocument extends Document {
  userId: unknown;
  repoId: unknown;
  analysisId: unknown;
  nodeKey: string;
  note?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pinnedFindingSchema = new Schema<PinnedFindingDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true, index: true },
    nodeKey: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 500 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

pinnedFindingSchema.index({ userId: 1, analysisId: 1, updatedAt: -1 });
pinnedFindingSchema.index(
  { userId: 1, analysisId: 1, nodeKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export const PinnedFinding = model<PinnedFindingDocument>(
  'PinnedFinding',
  pinnedFindingSchema
);
