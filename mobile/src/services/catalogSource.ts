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

export type CatalogChoice = { source: CatalogSource; apiBase?: string };
type Options = { chatApiUrl?: string; fallback?: string; fetcher?: typeof fetch };

// apiBase: the chat server, which serves the web catalog photos at /catalog-images/<file>.
export async function resolveCatalog({ chatApiUrl, fallback, fetcher = fetch }: Options): Promise<CatalogChoice> {
  const server = chatApiUrl ? { apiBase: chatApiUrl.replace(/\/+$/, '') } : {};
  if (chatApiUrl) {
    try {
      const response = await fetcher(new URL('/health', chatApiUrl).href, { signal: AbortSignal.timeout(4000) });
      const health = await response.json();
      const source = BY_CATALOG_ID[health?.catalog];
      if (source) return { source, ...server };
    } catch { /* server unreachable: fall back to the app setting */ }
  }
  return { source: fallback && SOURCES.includes(fallback) ? (fallback as CatalogSource) : 'amazon', ...server };
}
export const resolveCatalogSource = async (options: Options): Promise<CatalogSource> => (await resolveCatalog(options)).source;
