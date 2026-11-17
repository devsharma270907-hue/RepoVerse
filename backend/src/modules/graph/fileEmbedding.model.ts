import { Document, Schema, model } from 'mongoose';

/**
 * Per-file embedding for Smart Search (PRD §10.2).
 *
 * Only the DERIVED summary text (path, exports, imports, symbol names) is
 * stored alongside the vector — never source code (PRD §10.5). Vectors are
 * scoped to one analysis so refreshes never mix commits.
 *
 * The Atlas vector index lives outside Mongoose (see
 * `backend/atlas/file_summaries_v1.json`). On non-Atlas deployments the
 * search service uses an in-process cosine fallback over these documents.
 */

export interface FileEmbeddingDocument extends Document {
  analysisId: unknown;
  repoId: unknown;
  userId: unknown;
  path: string; // rel posix path
  text: string; // summary that was embedded (audit + reuse key)
  embedding: number[];
  embeddingModel: string;
  dimensions: number;
  createdAt: Date;
}

const fileEmbeddingSchema = new Schema<FileEmbeddingDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    path: { type: String, required: true },
    text: { type: String, required: true, maxlength: 8000 },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: true },
    dimensions: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

fileEmbeddingSchema.index({ analysisId: 1, path: 1 }, { unique: true });
fileEmbeddingSchema.index({ repoId: 1, analysisId: 1 });

export const FileEmbedding = model<FileEmbeddingDocument>(
  'FileEmbedding',
  fileEmbeddingSchema
);
