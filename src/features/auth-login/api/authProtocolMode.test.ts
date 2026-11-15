import { afterEach, expect, it, vi } from 'vitest';
import {
  isDirectAuthEnabled,
  isDirectRefreshVerified,
  isDirectSourceRecoveryVerified,
  isDirectRebootstrapVerified,
} from './authProtocolMode';

const FLAGS = [
  'VITE_AUTH_DIRECT_V2_ENABLED',
  'VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED',
  'VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED',
  'VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED',
] as const;
const INVALID_VALUES = [undefined, 'false', 'TRUE', ' true', 'true '];
const VERIFIED_GATES = [
  ['VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED', isDirectRefreshVerified],
  ['VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED', isDirectSourceRecoveryVerified],
  ['VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED', isDirectRebootstrapVerified],
] as const;

afterEach(() => vi.unstubAllEnvs());

it('defaults development to direct-v2 unless explicitly disabled', () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  for (const key of FLAGS) vi.stubEnv(key, undefined);
  vi.stubEnv(FLAGS[0], 'true');
  expect(
    isDirectAuthEnabled({ DEV: true, PROD: false, MODE: 'development' } as ImportMetaEnv),
  ).toBe(true);
  expect(isDirectRefreshVerified()).toBe(true);
  for (const value of ['TRUE', ' true', 'true ']) {
    vi.stubEnv(FLAGS[0], value);
    expect(isDirectAuthEnabled()).toBe(true);
  }
  vi.stubEnv(FLAGS[0], 'false');
  expect(isDirectAuthEnabled()).toBe(false);
  vi.stubEnv(FLAGS[0], 'true');
  expect(isDirectAuthEnabled()).toBe(true);
  expect(isDirectRefreshVerified()).toBe(true);
  expect(isDirectSourceRecoveryVerified()).toBe(false);
  expect(isDirectRebootstrapVerified()).toBe(false);
});

it.each(Array.from({ length: 16 }, (_, value) => value))(
  'requires only direct-v2 and normal-refresh verification in production combination %i',
  (combination) => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    FLAGS.forEach((key, bit) => vi.stubEnv(key, combination & (1 << bit) ? 'true' : 'false'));
    const directEnabled = (combination & 3) === 3;
    expect(isDirectAuthEnabled()).toBe(directEnabled);
    expect(isDirectRefreshVerified()).toBe(directEnabled);
    expect(isDirectSourceRecoveryVerified()).toBe(directEnabled && Boolean(combination & 4));
    expect(isDirectRebootstrapVerified()).toBe(directEnabled && Boolean(combination & 8));
  },
);

it.each(FLAGS)('rejects missing or malformed production %s', (key) => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('PROD', true);
  for (const flag of FLAGS) vi.stubEnv(flag, 'true');
  for (const value of INVALID_VALUES) {
    vi.stubEnv(key, value);
    const requiredProtocolFlag = key === FLAGS[0] || key === FLAGS[1];
    expect(isDirectAuthEnabled()).toBe(!requiredProtocolFlag);
    if (key === FLAGS[1]) expect(isDirectRefreshVerified()).toBe(false);
  }
});

it.each(VERIFIED_GATES)('preserves independent DEV opt-in for %s', (key, enabled) => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  vi.stubEnv(FLAGS[0], 'true');
  for (const value of INVALID_VALUES) {
    vi.stubEnv(key, value);
    expect(enabled()).toBe(key === FLAGS[1] && value === undefined);
    expect(isDirectAuthEnabled()).toBe(true);
  }
  vi.stubEnv(key, 'true');
  expect(enabled()).toBe(true);
  vi.stubEnv(FLAGS[0], 'false');
  expect(enabled()).toBe(false);
});

it('fails closed without a recognized Vite build environment', () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('PROD', false);
  for (const flag of FLAGS) vi.stubEnv(flag, 'true');
  expect(isDirectAuthEnabled()).toBe(false);
});
