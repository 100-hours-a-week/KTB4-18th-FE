import type { LocationResolution } from '../../src/api/locationResolutions';

declare global {
  interface Window {
    musicRelease: { token: string; location: string; region: number };
  }
}
// The GPS/token issuance boundary is synthetic; membership and all music/chat operations use real servers.
export async function resolveCurrentChatLocation(): Promise<LocationResolution> {
  return {
    mapDot: null,
    region: {
      sido: { regionId: 1, code: '41', name: '검증 광역 지역' },
      sigungu: { regionId: window.musicRelease.region, code: '41135', name: '검증 지역' },
    },
    locationResolutionToken: window.musicRelease.location,
    expiresIn: 300,
  };
}
