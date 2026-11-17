import { describe, expect, it } from 'vitest';
import {
  formatBytesFromKb,
  formatDate,
  formatRelative,
  languageLabel,
  pluralize,
  shortSha,
} from '@/lib/format';

describe('formatting helpers', () => {
  it('formats sizes from kilobytes', () => {
    expect(formatBytesFromKb(undefined)).toBe('—');
    expect(formatBytesFromKb(512)).toBe('512 KB');
    expect(formatBytesFromKb(1024)).toBe('1.0 MB');
    expect(formatBytesFromKb(1024 * 20)).toBe('20 MB');
  });

  it('shortens commit SHAs', () => {
    expect(shortSha(null)).toBe('—');
    expect(shortSha('deadbeefcafebabe')).toBe('deadbeef');
  });

  it('labels languages', () => {
    expect(languageLabel('ts')).toBe('TypeScript');
    expect(languageLabel('tsx')).toBe('TSX');
    expect(languageLabel('py')).toBe('Python');
    expect(languageLabel('rs')).toBe('RS');
  });

  it('pluralises counts', () => {
    expect(pluralize(1, 'file')).toBe('file');
    expect(pluralize(0, 'file')).toBe('files');
    expect(pluralize(2, 'repository', 'repositories')).toBe('repositories');
  });

  it('renders an em dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatRelative(undefined)).toBe('—');
  });

  it('renders recent timestamps relatively', () => {
    expect(formatRelative(new Date().toISOString())).toBe('just now');
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelative(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });
});
