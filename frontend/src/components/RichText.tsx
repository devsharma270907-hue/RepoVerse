import { useMemo } from 'react';
import DOMPurify from 'dompurify';

/**
 * Renders AI-generated prose safely.
 *
 * The checklist requires DOMPurify on every AI-rendered string and forbids raw
 * `dangerouslySetInnerHTML`. We escape first, apply a tiny, explicit subset of
 * Markdown (bold, inline code, paragraphs, bullet lists), then sanitize again
 * with a strict allowlist as defence in depth.
 */

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'ul', 'ol', 'li'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownLiteToSafeHtml(text: string): string {
  const escaped = escapeHtml(text.trim());
  const lines = escaped.split(/\r?\n/);
  const blocks: string[] = [];
  let list: string[] = [];

  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    flushList();
    blocks.push(`<p>${inline(line)}</p>`);
  }
  flushList();

  return DOMPurify.sanitize(blocks.join(''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdownLiteToSafeHtml(text), [text]);
  return (
    <div
      className={['rich-text', className].filter(Boolean).join(' ')}
      // Sanitized above with a strict tag allowlist; never raw AI output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
