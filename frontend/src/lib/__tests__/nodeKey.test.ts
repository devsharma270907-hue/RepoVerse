import { describe, expect, it } from 'vitest';
import {
  encodeNodeKey,
  fileKey,
  filePathOfKey,
  kindOfKey,
  labelOfKey,
  symbolKey,
  symbolNameOfKey,
} from '@/lib/nodeKey';

describe('node keys', () => {
  it('classifies repo, file and symbol keys', () => {
    expect(kindOfKey('repo:1')).toBe('repo');
    expect(kindOfKey('file:src/app.ts')).toBe('file');
    expect(kindOfKey('sym:src/app.ts#boot')).toBe('symbol');
    expect(kindOfKey('mystery')).toBe('unknown');
  });

  it('extracts file paths from both key kinds', () => {
    expect(filePathOfKey('file:src/app.ts')).toBe('src/app.ts');
    expect(filePathOfKey('sym:src/app.ts#boot')).toBe('src/app.ts');
    expect(filePathOfKey('sym:src/app.ts#A.b')).toBe('src/app.ts');
    expect(filePathOfKey('repo:1')).toBeNull();
  });

  it('extracts symbol names', () => {
    expect(symbolNameOfKey('sym:src/app.ts#A.b')).toBe('A.b');
    expect(symbolNameOfKey('file:src/app.ts')).toBeNull();
  });

  it('builds canonical keys and strips leading slashes', () => {
    expect(fileKey('/src/app.ts')).toBe('file:src/app.ts');
    expect(symbolKey('/src/app.ts', 'boot')).toBe('sym:src/app.ts#boot');
  });

  it('encodes # for query strings', () => {
    expect(encodeNodeKey('sym:a.ts#a')).toBe('sym:a.ts%23a');
    expect(encodeNodeKey('file:a.ts')).toBe('file:a.ts');
  });

  it('produces a readable label', () => {
    expect(labelOfKey('sym:a.ts#run')).toBe('run');
    expect(labelOfKey('file:a.ts')).toBe('a.ts');
    expect(labelOfKey('repo:1')).toBe('repo:1');
  });
});
