import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { markdownLiteToSafeHtml, RichText } from '@/components/RichText';

describe('markdownLiteToSafeHtml', () => {
  it('renders bold and inline code', () => {
    const html = markdownLiteToSafeHtml('Hello **world** and `code`');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders dash and star bullet lists', () => {
    const html = markdownLiteToSafeHtml('- one\n* two');
    expect(html).toContain('<ul>');
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it('splits paragraphs on blank lines', () => {
    const html = markdownLiteToSafeHtml('first\n\nsecond');
    expect(html).toContain('<p>first</p>');
    expect(html).toContain('<p>second</p>');
  });

  it('escapes raw HTML instead of executing it', () => {
    const html = markdownLiteToSafeHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('strips script tags and event attributes', () => {
    const html = markdownLiteToSafeHtml('<script>alert(1)</script>');
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('keeps only allowlisted tags', () => {
    const html = markdownLiteToSafeHtml('**bold** <a href="https://x.test">x</a>');
    expect(html).not.toContain('<a');
    expect(html).toContain('<strong>bold</strong>');
  });
});

describe('<RichText />', () => {
  it('renders sanitized content as text, never raw model output', () => {
    const { container } = render(
      <RichText text={'Summary **point**.\n\n- first\n- second'} />
    );
    expect(screen.getByText('point')).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.innerHTML).not.toContain('<script');
  });
});
