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

export type CatalogChoice = { source: CatalogSource; webImageBase?: string };
type Options = { chatApiUrl?: string; fallback?: string; fetcher?: typeof fetch };

// webImageBase: where the server serves the web catalog photos (the local dev server's copy);
// without it the photos come from products-kr.json image_url (the Supabase Storage bucket).
export async function resolveCatalog({ chatApiUrl, fallback, fetcher = fetch }: Options): Promise<CatalogChoice> {
  if (chatApiUrl) {
    try {
      const response = await fetcher(new URL('/health', chatApiUrl).href, { signal: AbortSignal.timeout(4000) });
      const health = await response.json();
      const source = BY_CATALOG_ID[health?.catalog];
      if (source) return { source, ...(typeof health.webImageBase === 'string' ? { webImageBase: health.webImageBase } : {}) };
    } catch { /* server unreachable: fall back to the app setting */ }
  }
  return { source: fallback && SOURCES.includes(fallback) ? (fallback as CatalogSource) : 'amazon' };
}
export const resolveCatalogSource = async (options: Options): Promise<CatalogSource> => (await resolveCatalog(options)).source;
