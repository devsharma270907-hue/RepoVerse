import { z } from 'zod';

/**
 * GitHub PAT input (PUT /users/me/github-token) — same `{ body }` shape as
 * the other schema modules so it plugs into `validate()`.
 * Accepts classic (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) and fine-grained
 * (`github_pat_`) tokens. Real validity is confirmed against the GitHub API;
 * this only rejects obvious garbage before any network call.
 */
export const githubTokenSchema = {
  body: z.object({
    token: z
      .string()
      .trim()
      .min(20, 'Token is too short')
      .max(255, 'Token is too long')
      .regex(
        /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/,
        'Not a valid GitHub personal access token'
      ),
  }),
};

/**
 * Account deletion requires typing an exact confirmation phrase (blueprint
 * data & privacy) — a stray DELETE cannot erase an account.
 */
export const deleteAccountSchema = {
  body: z.object({
    confirmation: z
      .string()
      .trim()
      .refine(
        (value) => value === 'DELETE MY ACCOUNT',
        'Type "DELETE MY ACCOUNT" to confirm account deletion'
      ),
  }),
};
