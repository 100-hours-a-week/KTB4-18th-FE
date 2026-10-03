export type AvailabilityField = 'nickname' | 'email';

type AvailabilityResponse = {
  message: 'availability checked';
  data: { available: boolean };
};

function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'message' in value &&
    value.message === 'availability checked' &&
    'data' in value &&
    typeof value.data === 'object' &&
    value.data !== null &&
    !Array.isArray(value.data) &&
    'available' in value.data &&
    typeof value.data.available === 'boolean'
  );
}

export async function checkUserAvailability(
  field: AvailabilityField,
  value: string,
): Promise<boolean> {
  const query = new URLSearchParams({ value });
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/users/availability/${field}?${query}`,
    { cache: 'no-store' },
  );
  if (response.status === 429) throw new Error('too many requests');
  if (!response.ok) throw new Error('availability unavailable');

  const body: unknown = await response.json();
  if (!isAvailabilityResponse(body)) throw new Error('availability unavailable');
  return body.data.available;
}
