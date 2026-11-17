import { z } from 'zod';
import { parseGitHubUrl } from '../../utils/githubUrl';

const githubUrlField = z
  .string()
  .trim()
  .min(1, 'Repository URL is required')
  .refine(
    (value) => parseGitHubUrl(value) !== null,
    'Must be a valid github.com repository URL (https://github.com/<owner>/<repo>)'
  );

export const registerRepoSchema = {
  body: z.object({
    url: githubUrlField,
    branch: z.string().trim().min(1).max(100).optional(),
  }),
};

export const idParamSchema = {
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid resource id'),
  }),
};

export const listQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};
