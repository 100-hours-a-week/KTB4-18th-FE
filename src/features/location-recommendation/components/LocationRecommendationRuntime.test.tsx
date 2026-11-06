import { describe, expect, it } from 'vitest';
import {
  isLocationRecommendationServiceRoute,
  isSameUrlMapPageAccess,
} from '../locationRecommendationRoutes';

describe('location recommendation service route eligibility', () => {
  it('allows only routes rendered by the service', () => {
    for (const pathname of [
      '/',
      '/my',
      '/music-records',
      '/music-records/new',
      '/music-records/123',
    ]) {
      expect(isLocationRecommendationServiceRoute(pathname)).toBe(true);
    }
  });

  it('does not sample location on authentication or not-found routes', () => {
    for (const pathname of [
      '/login',
      '/signup',
      '/settings',
      '/not-found',
      '/music-records/invalid',
      '/chatbot',
      '/chat',
    ]) {
      expect(isLocationRecommendationServiceRoute(pathname)).toBe(false);
    }
  });

  it('recognizes a repeated map entry when navigation leaves the URL unchanged', () => {
    const currentUrl = 'http://127.0.0.1:5180/';

    expect(isSameUrlMapPageAccess(currentUrl, currentUrl)).toBe(true);
    expect(isSameUrlMapPageAccess('http://127.0.0.1:5180/music-records', currentUrl)).toBe(false);
    expect(isSameUrlMapPageAccess(currentUrl, 'http://127.0.0.1:5180/?view=recent')).toBe(false);
    expect(isSameUrlMapPageAccess('not-a-url', 'not-a-url')).toBe(false);
  });
});
