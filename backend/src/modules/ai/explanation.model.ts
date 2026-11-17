import { Document, Schema, model } from 'mongoose';

/**
 * Cached AI code explanation (PRD §4.6 / §10.3).
 * Keyed per (analysis, node) — an analysis pins its commit SHA and the
 * model version is stored alongside, so re-analyzes of unchanged code are
 * free and a model switch invalidates naturally via a new analysis.
 */
export interface ExplanationDocument extends Document {
  analysisId: unknown;
  repoId: unknown;
  userId: unknown;
  nodeKey: string; // `file:<path>` | `sym:<path>#<name>`
  modelVersion: string;
  source: {
    path: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
    /** Redacted excerpt sent to the model, so the UI can always show it. */
    text?: string;
  };
  content: {
    summary: string;
    keyPoints: string[];
    potentialIssues: string[];
  };
  createdAt: Date;
}

const explanationSchema = new Schema<ExplanationDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    nodeKey: { type: String, required: true },
    modelVersion: { type: String, required: true },
    source: {
      path: { type: String, required: true },
      startLine: { type: Number, required: true },
      endLine: { type: Number, required: true },
      truncated: { type: Boolean, required: true },
      text: { type: String, default: '' },
    },
    content: {
      summary: { type: String, required: true },
      keyPoints: { type: [String], required: true },
      potentialIssues: { type: [String], required: true },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

explanationSchema.index({ analysisId: 1, nodeKey: 1 }, { unique: true });

export const Explanation = model<ExplanationDocument>(
  'Explanation',
  explanationSchema
);
