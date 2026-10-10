export function readMusicRecordSidoCode(): string | null {
  return new URLSearchParams(window.location.search).get('sido') || null;
}

export function musicRecordFilterPath(path: string, sidoCode: string | null): string {
  const url = new URL(path, window.location.origin);
  if (sidoCode === null) url.searchParams.delete('sido');
  else url.searchParams.set('sido', sidoCode);
  return `${url.pathname}${url.search}${url.hash}`;
}
