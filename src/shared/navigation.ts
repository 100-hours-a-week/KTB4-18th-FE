export const ROUTE_CHANGE_EVENT = 'meomuneum:route-change';

export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}
