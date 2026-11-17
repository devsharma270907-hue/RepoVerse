import { Document, Schema, model } from 'mongoose';

export interface GraphNodeDocument extends Document {
  analysisId: unknown;
  repoId: unknown;
  userId: unknown;
  key: string; // `file:<relpath>` | `sym:<relpath>#<name>` | `repo:<id>`
  kind: 'repo' | 'file' | 'class' | 'function' | 'method';
  path?: string;
  name?: string;
  loc?: number;
  exported?: boolean;
  fanIn: number;
  fanOut: number;
  endLine?: number;
  paramCount?: number;
  complexity?: number;
  createdAt: Date;
}

const graphNodeSchema = new Schema<GraphNodeDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['repo', 'file', 'class', 'function', 'method'],
    },
    path: { type: String },
    name: { type: String },
    loc: { type: Number },
    exported: { type: Boolean },
    fanIn: { type: Number, default: 0 },
    fanOut: { type: Number, default: 0 },
    endLine: { type: Number },
    paramCount: { type: Number },
    complexity: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

graphNodeSchema.index({ analysisId: 1, key: 1 }, { unique: true });

export const GraphNode = model<GraphNodeDocument>('GraphNode', graphNodeSchema);
