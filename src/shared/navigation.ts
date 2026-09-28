export const ROUTE_CHANGE_EVENT = 'meomuneum:route-change';

type RouteLocation = { pathname: string; search: string; hash: string };

function routeLocation(url: URL): RouteLocation {
  return { pathname: url.pathname, search: url.search, hash: url.hash };
}

export function navigate(path: string): void {
  const destination = new URL(path, window.location.origin);
  if (destination.origin !== window.location.origin) return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = `${destination.pathname}${destination.search}${destination.hash}`;
  if (current !== next) window.history.pushState(null, '', next);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function handleInternalLinkClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.hasAttribute('download')) return;
  const target = anchor.getAttribute('target');
  if (target && target.toLowerCase() !== '_self') return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return;

  let destination: URL;
  try {
    destination = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (destination.origin !== window.location.origin || destination.hash) return;
  event.preventDefault();
  navigate(`${destination.pathname}${destination.search}`);
}

export function installSpaLinkHandler(): () => void {
  document.addEventListener('click', handleInternalLinkClick);
  return () => document.removeEventListener('click', handleInternalLinkClick);
}

export function readRouteLocation(): RouteLocation {
  return routeLocation(new URL(window.location.href));
}
