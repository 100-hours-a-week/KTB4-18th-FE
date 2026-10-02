import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSpaLinkHandler, navigate, replaceRoute, ROUTE_CHANGE_EVENT } from './navigation';

let removeHandler: (() => void) | undefined;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  removeHandler = installSpaLinkHandler();
});

afterEach(() => {
  removeHandler?.();
  document.body.innerHTML = '';
});

function link(href: string, attributes = ''): HTMLAnchorElement {
  document.body.innerHTML = `<a href="${href}" ${attributes}>go</a>`;
  return document.querySelector('a')!;
}

describe('delegated SPA navigation', () => {
  it('navigates ordinary same-origin page links without a document navigation', () => {
    const changed = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, changed, { once: true });
    const anchor = link('/chatbot');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/chatbot');
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each([
    ['middle click', { button: 1 }],
    ['ctrl click', { button: 0, ctrlKey: true }],
    ['meta click', { button: 0, metaKey: true }],
    ['shift click', { button: 0, shiftKey: true }],
    ['alt click', { button: 0, altKey: true }],
  ])('preserves %s', (_label, options) => {
    const anchor = link('/chatbot');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });

    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it.each([
    ['target blank', '/chatbot', 'target="_blank"'],
    ['download', '/file', 'download'],
    ['external link', 'https://example.com/chatbot', ''],
    ['hash anchor', '/#features', ''],
  ])('preserves %s', (_label, href, attributes) => {
    const anchor = link(href, attributes);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('does not override an earlier handler that canceled the event', () => {
    const anchor = link('/chatbot');
    anchor.addEventListener('click', (event) => event.preventDefault(), { once: true });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('supports browser history by leaving pushState entries in the stack', async () => {
    navigate('/music-records');
    navigate('/chatbot');
    const returned = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    window.history.back();
    await returned;

    expect(window.location.pathname).toBe('/music-records');
  });

  it('replaces the current history entry and notifies the SPA router', () => {
    const changed = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, changed, { once: true });
    window.history.pushState(null, '', '/music-records');

    replaceRoute('/login?returnTo=%2Fmusic-records');

    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?returnTo=%2Fmusic-records');
    expect(changed).toHaveBeenCalledOnce();
  });
});
