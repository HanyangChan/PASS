// Which product catalog the app's own screens (ranking tab, guest chat) use.
// The chat server decides it with CATALOG_SOURCE and reports it on /health; the app follows that
// so both always show the same catalog. Without a reachable server, EXPO_PUBLIC_CATALOG_SOURCE
// (amazon | web | both) applies, and the default is amazon.
export type CatalogSource = 'amazon' | 'web' | 'both';
const SOURCES: readonly string[] = ['amazon', 'web', 'both'];
const BY_CATALOG_ID: Record<string, CatalogSource> = {
  'amazon-kaggle-v1': 'amazon',
  'naver-web-v1': 'web',
  'amazon-kaggle-v1+naver-web-v1': 'both',
};

export async function resolveCatalogSource({ chatApiUrl, fallback, fetcher = fetch }: {
  chatApiUrl?: string; fallback?: string; fetcher?: typeof fetch;
}): Promise<CatalogSource> {
  if (chatApiUrl) {
    try {
      const response = await fetcher(new URL('/health', chatApiUrl).href, { signal: AbortSignal.timeout(4000) });
      const source = BY_CATALOG_ID[(await response.json())?.catalog];
      if (source) return source;
    } catch { /* server unreachable: fall back to the app setting */ }
  }
  return fallback && SOURCES.includes(fallback) ? (fallback as CatalogSource) : 'amazon';
}
