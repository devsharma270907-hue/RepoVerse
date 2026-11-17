import { Document, Schema, model } from 'mongoose';

export interface GraphEdgeDocument extends Document {
  analysisId: unknown;
  repoId: unknown;
  userId: unknown;
  from: string; // node key
  to: string; // node key
  kind: 'defines' | 'imports' | 'calls' | 'extends';
  createdAt: Date;
}

const graphEdgeSchema = new Schema<GraphEdgeDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, ref: 'Analysis', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['defines', 'imports', 'calls', 'extends'],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

graphEdgeSchema.index({ analysisId: 1, from: 1 });
graphEdgeSchema.index({ analysisId: 1, to: 1 });

export const GraphEdge = model<GraphEdgeDocument>('GraphEdge', graphEdgeSchema);
