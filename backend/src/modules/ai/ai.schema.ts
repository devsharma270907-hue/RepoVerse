import { z } from 'zod';

export const explainSchema = {
  body: z.object({
    node: z
      .string()
      .trim()
      .min(1, 'Node key is required (e.g. "file:src/index.ts" or "sym:src/index.ts#main")')
      .max(300),
  }),
};

export const searchSchema = {
  body: z.object({
    query: z
      .string()
      .trim()
      .min(2, 'Query must be at least 2 characters')
      .max(300),
  }),
};

/** Zod-validated Claude output for explanations (PRD §10.3). */
export const explanationOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  keyPoints: z.array(z.string().min(1).max(500)).max(10),
  potentialIssues: z.array(z.string().min(1).max(500)).max(10),
});

export type ExplanationOutput = z.infer<typeof explanationOutputSchema>;

/** Zod-validated Claude output for Smart Search synthesis (PRD §10.2). */
export const searchSynthesisSchema = z.object({
  results: z
    .array(
      z.object({
        nodeKey: z.string().min(1).max(300),
        why: z.string().min(1).max(300),
      })
    )
    .max(10),
});

export type SearchSynthesisOutput = z.infer<typeof searchSynthesisSchema>;
