export function getHighResolutionArtworkUrl(url: string | null): string | null {
  return url?.replace(/\/\d+x\d+bb(?=[./?-]|$)/i, '/680x680bb') ?? null;
}
