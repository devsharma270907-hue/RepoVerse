import { Document, Schema, model } from 'mongoose';
import { SymbolKind } from '../../services/analyzer/parser';

/**
 * Derived per-file parse snapshot (PRD §4.8 / §10.5).
 *
 * Diff-aware refresh compares each file's sha256 against the previous
 * analysis: unchanged files are restored from these snapshots instead of
 * being re-parsed. Only DERIVED metadata is stored — file path, hash, LOC,
 * resolved internal imports, symbol summaries and call-name sets. Source
 * code is never persisted (repo content stays transient, §10.5).
 *
 * Retention: only the latest analysis (and its predecessor) keep snapshots;
 * older ones are pruned by the pipeline after a successful run.
 */

export interface SnapshotSymbol {
  key: string;
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
  endLine?: number;
  paramCount?: number;
  complexity?: number;
  extends?: string[];
}

export interface FileSnapshotDocument extends Document {
  analysisId: unknown;
  repoId: unknown;
  userId: unknown;
  path: string; // rel posix path
  hash: string; // sha256 of the file bytes
  loc: number;
  imports: string[]; // resolved internal imports (rel posix)
  symbols: SnapshotSymbol[];
  callNames: string[];
  createdAt: Date;
}

const snapshotSymbolSchema = new Schema<SnapshotSymbol>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ['class', 'function', 'method'], required: true },
    line: { type: Number, required: true },
    exported: { type: Boolean, default: false },
    endLine: { type: Number },
    paramCount: { type: Number },
    complexity: { type: Number },
    extends: { type: [String] },
  },
  { _id: false }
);

const fileSnapshotSchema = new Schema<FileSnapshotDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    path: { type: String, required: true },
    hash: { type: String, required: true },
    loc: { type: Number, required: true },
    imports: { type: [String], default: [] },
    symbols: { type: [snapshotSymbolSchema], default: [] },
    callNames: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

fileSnapshotSchema.index({ analysisId: 1, path: 1 }, { unique: true });

export const FileSnapshot = model<FileSnapshotDocument>('FileSnapshot', fileSnapshotSchema);
