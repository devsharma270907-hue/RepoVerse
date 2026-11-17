import { Document, Schema, model } from 'mongoose';

/**
 * Saved workspace view (PRD Phase 3 — persistent workspace state).
 * Stores only map/UI intent (focus, filters, search, highlights) — never
 * source code. Scoped to one repo + owner.
 */

export interface SavedViewState {
  level: 'file' | 'symbol';
  searchQuery?: string;
  focusNode?: string;
  isolatedNode?: string;
  highlightedNodes: string[];
  filterKinds: string[];
}

export interface SavedViewDocument extends Document {
  userId: unknown;
  repoId: unknown;
  name: string;
  description?: string;
  state: SavedViewState;
  isPinned: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const savedViewStateSchema = new Schema<SavedViewState>(
  {
    level: { type: String, enum: ['file', 'symbol'], default: 'file' },
    searchQuery: { type: String },
    focusNode: { type: String },
    isolatedNode: { type: String },
    highlightedNodes: { type: [String], default: [] },
    filterKinds: { type: [String], default: [] },
  },
  { _id: false }
);

const savedViewSchema = new Schema<SavedViewDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    state: { type: savedViewStateSchema, required: true },
    isPinned: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

savedViewSchema.index({ userId: 1, repoId: 1, updatedAt: -1 });
// Names are unique per (owner, repo) among live views; soft-deleted names free up
savedViewSchema.index(
  { userId: 1, repoId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export const SavedView = model<SavedViewDocument>('SavedView', savedViewSchema);
