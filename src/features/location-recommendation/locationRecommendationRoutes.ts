export function isLocationRecommendationServiceRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/my' ||
    pathname === '/music-records' ||
    pathname === '/music-records/new' ||
    /^\/music-records\/[1-9]\d*$/.test(pathname)
  );
}
