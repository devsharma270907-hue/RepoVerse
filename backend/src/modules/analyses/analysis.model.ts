import { Document, Schema, model } from 'mongoose';

export const ANALYSIS_STATUSES = [
  'queued',
  'fetching',
  'parsing',
  'building_graph',
  'done',
  'failed',
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ACTIVE_STATUSES: AnalysisStatus[] = [
  'queued',
  'fetching',
  'parsing',
  'building_graph',
];

export interface LanguageCount {
  ext: string;
  count: number;
}

export interface AnalysisSummary {
  fileCount: number;
  symbolCount: number;
  cycleCount: number;
  healthScore: number;
  skippedLarge: number;
  truncated: boolean;
  languages: LanguageCount[];
  // Present on diff-aware refreshes (PRD §4.8) — absent on first analysis
  diff?: {
    reusedFiles: number;
    changedFiles: number;
    addedFiles: number;
    deletedFiles: number;
  };
  // Present when per-file embeddings were generated (PRD §10.2)
  embeddedFiles?: number;
}

export interface AnalysisDocument extends Document {
  userId: unknown;
  repoId: unknown;
  status: AnalysisStatus;
  progress: number; // 0–100
  commitSha?: string;
  error?: { code: string; message: string };
  summary?: AnalysisSummary;
  cycles?: Array<{
    path: string[];
    length: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  startedAt?: Date;
  finishedAt?: Date;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const summaryDiffSchema = new Schema(
  {
    reusedFiles: { type: Number },
    changedFiles: { type: Number },
    addedFiles: { type: Number },
    deletedFiles: { type: Number },
  },
  { _id: false }
);

const analysisSummarySchema = new Schema(
  {
    fileCount: { type: Number },
    symbolCount: { type: Number },
    cycleCount: { type: Number },
    healthScore: { type: Number },
    skippedLarge: { type: Number },
    truncated: { type: Boolean },
    languages: [{ _id: false, ext: String, count: Number }],
    // `default: undefined` — never store an empty `diff` object on first runs
    diff: { type: summaryDiffSchema, default: undefined },
    embeddedFiles: { type: Number },
  },
  { _id: false }
);

const analysisSchema = new Schema<AnalysisDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    status: { type: String, enum: ANALYSIS_STATUSES, default: 'queued' },
    progress: { type: Number, default: 0 },
    commitSha: { type: String },
    error: {
      code: { type: String },
      message: { type: String },
    },
    summary: { type: analysisSummarySchema, default: undefined },
    cycles: [
      {
        path: [String],
        length: { type: Number },
        severity: { type: String, enum: ['low', 'medium', 'high'] },
      },
    ],
    startedAt: { type: Date },
    finishedAt: { type: Date },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

analysisSchema.index({ userId: 1, createdAt: -1 });
analysisSchema.index({ repoId: 1, createdAt: -1 });

export const Analysis = model<AnalysisDocument>('Analysis', analysisSchema);
