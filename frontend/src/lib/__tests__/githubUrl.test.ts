import { describe, expect, it } from 'vitest';
import {
  githubUrl,
  isValidGitHubUrl,
  parseGitHubUrl,
} from '@/lib/githubUrl';

describe('githubUrl', () => {
  it('accepts canonical repository URLs', () => {
    expect(parseGitHubUrl('https://github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('strips a trailing .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo',
    });
  });

  it('ignores query strings, fragments and extra path segments', () => {
    expect(
      parseGitHubUrl('https://github.com/owner/repo/tree/main/src?x=1#readme')
    ).toEqual({ owner: 'owner', name: 'repo' });
  });

  it('trims surrounding whitespace', () => {
    expect(isValidGitHubUrl('  https://github.com/a/b  ')).toBe(true);
  });

  it.each([
    'http://github.com/a/b',
    'https://gitlab.com/a/b',
    'https://github.com/',
    'https://github.com/only-owner',
    'https://github.com.evil.test/a/b',
    'git@github.com:a/b.git',
    'not a url',
    '',
  ])('rejects %s', (value) => {
    expect(parseGitHubUrl(value)).toBeNull();
  });

  it('rejects an owner that starts or ends with a dash', () => {
    expect(parseGitHubUrl('https://github.com/-owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://github.com/owner-/repo')).toBeNull();
  });

  it('builds a canonical URL', () => {
    expect(githubUrl('vercel', 'next.js')).toBe('https://github.com/vercel/next.js');
  });
});
