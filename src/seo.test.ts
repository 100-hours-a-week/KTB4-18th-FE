import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectLoginPage } from './features/auth-login/components/DirectLoginPage';
import { useSearchMetadata } from './hooks/useSearchMetadata';

const HTML = readFileSync(resolve('index.html'), 'utf8');
const CANONICAL = 'https://meomuneum.com/login';
const parseHtml = () => new DOMParser().parseFromString(HTML, 'text/html');
const originalHead = document.head.innerHTML;

afterEach(() => {
  cleanup();
  document.head.innerHTML = originalHead;
});

describe('public search document', () => {
  it('keeps service descriptions in metadata without adding visible content', () => {
    const page = parseHtml();
    const description = page.querySelector('meta[name="description"]')?.getAttribute('content');
    expect(page.documentElement.lang).toBe('ko');
    expect(page.querySelector('#root')?.textContent).toBe('');
    expect(page.querySelector('noscript')).toBeNull();
    render(createElement(DirectLoginPage));
    expect(screen.queryByText(/머문음은 텍스트/)).toBeNull();
    expect(screen.getByRole('heading', { name: '오늘도, 한 곡 남겨볼까요?' })).toBeDefined();
    expect(description).toMatch(/AI 음악 추천.*장소.*음악과 메모.*로그인 후/);
    expect(page.title).toMatch(/^머문음.*AI 음악 추천/);
    expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(CANONICAL);
    expect(page.querySelector('link[rel="icon"]')?.getAttribute('type')).toBe('image/x-icon');
    expect(page.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(
      description,
    );
    expect(page.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      page.title,
    );
    expect(page.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(CANONICAL);
  });

  it('publishes only the visible website identity as structured data', () => {
    const page = parseHtml();
    const schema = JSON.parse(
      page.querySelector('script[type="application/ld+json"]')!.textContent!,
    );
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@graph']).toEqual([
      {
        '@type': 'WebSite',
        name: '머문음',
        url: 'https://meomuneum.com/',
        inLanguage: 'ko',
      },
    ]);
  });

  it.each([
    ['/', 'index,follow'],
    ['/login', 'index,follow'],
    ['/music-records/42', 'noindex,follow'],
    ['/chatbot', 'noindex,follow'],
    ['/signup', 'noindex,follow'],
    ['/password/reset', 'noindex,follow'],
    ['/unknown', 'noindex,follow'],
  ])('sets initial indexing for %s before the app bundle', (pathname, expected) => {
    const page = parseHtml();
    const scripts = Array.from(page.querySelectorAll('script'));
    const earlyScript = scripts.find((script) =>
      script.textContent?.includes('location.pathname'),
    )!;
    expect(earlyScript).toBeDefined();
    expect(scripts.indexOf(earlyScript)).toBeLessThan(
      scripts.findIndex((script) => script.type === 'module'),
    );
    runInNewContext(earlyScript.textContent!, { location: { pathname }, document: page });
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(expected);
    expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(CANONICAL);
  });

  it('allows search crawling, excludes APIs and blocks GPTBot training', () => {
    const robots = readFileSync(resolve('public/robots.txt'), 'utf8');
    const groups = robots.trim().split(/\n\s*\n/);
    expect(groups[0]?.split('\n')).toEqual(['User-agent: *', 'Allow: /', 'Disallow: /api/']);
    expect(groups[1]?.split('\n')).toEqual(['User-agent: GPTBot', 'Disallow: /']);
    expect(groups[2]).toBe('Sitemap: https://meomuneum.com/sitemap.xml');
    expect(robots).not.toContain('OAI-SearchBot');
    const sitemap = new DOMParser().parseFromString(
      readFileSync(resolve('public/sitemap.xml'), 'utf8'),
      'application/xml',
    );
    expect(sitemap.querySelector('parsererror')).toBeNull();
    expect(Array.from(sitemap.querySelectorAll('loc'), (node) => node.textContent)).toEqual([
      CANONICAL,
    ]);
    expect(sitemap.querySelector('lastmod')).toBeNull();
  });
});

describe('SPA search metadata', () => {
  it('restores public indexing across route changes without duplicates or private metadata', () => {
    document.head.innerHTML = parseHtml().head.innerHTML;
    const { rerender } = renderHook(({ pathname }) => useSearchMetadata(pathname), {
      initialProps: { pathname: '/login' },
    });
    for (const [pathname, expected] of [
      ['/login', 'index,follow'],
      ['/music-records/42', 'noindex,follow'],
      ['/', 'index,follow'],
      ['/unknown', 'noindex,follow'],
      ['/signup', 'noindex,follow'],
      ['/login', 'index,follow'],
    ]) {
      rerender({ pathname });
      expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(expected);
      expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(CANONICAL);
      expect(document.title).toBe(parseHtml().title);
      expect(document.head.innerHTML).not.toContain('/music-records/42');
    }
  });
});
