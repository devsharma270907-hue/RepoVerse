import { Document, Schema, model } from 'mongoose';

export interface RepoDocument extends Document {
  userId: unknown; // ObjectId ref → User
  githubOwner: string;
  githubName: string;
  url: string;
  branch: string;
  defaultBranch?: string;
  sizeKb?: number;
  isPrivate?: boolean;
  isDeleted: boolean; // soft-delete pattern (blueprint Section 6)
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const repoSchema = new Schema<RepoDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    githubOwner: { type: String, required: true },
    githubName: { type: String, required: true },
    url: { type: String, required: true },
    branch: { type: String, required: true },
    defaultBranch: { type: String },
    sizeKb: { type: Number },
    isPrivate: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

// Same repo+branch is unique per user; re-adding restores/deletes handle the rest
repoSchema.index(
  { userId: 1, githubOwner: 1, githubName: 1, branch: 1 },
  { unique: true }
);

export const Repo = model<RepoDocument>('Repo', repoSchema);
