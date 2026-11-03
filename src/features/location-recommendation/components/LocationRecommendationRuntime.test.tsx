import { describe, expect, it } from 'vitest';
import { isLocationRecommendationServiceRoute } from '../locationRecommendationRoutes';

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
});
