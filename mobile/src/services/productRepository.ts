import { fetchCatalog, toEngineProduct, todayKst } from '../../../lib/catalog.mjs';
import { fromWebItem, mergeCatalogs } from '../../../lib/catalog-source.mjs';
import type { EngineProduct } from '../domain.ts';
import type { CatalogChoice, CatalogSource } from './catalogSource.ts';
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export const catalogKey = 'pass.catalog.v1';
const DAY = 86400000;
// Guests and signed-in users read the same public catalog; the last copy survives offline starts.
// source() picks amazon | web | both (see catalogSource.ts), with the chat server that serves the web photos;
// webItems() loads supabase/seed/products-kr.json.
export function createProductRepository({ url, key, storage, fetcher = fetch, now = Date.now, source = async () => 'amazon', webItems }: {
  url: string; key: string; storage: Storage; fetcher?: typeof fetch; now?: () => number;
  source?: () => Promise<CatalogSource | CatalogChoice>; webItems?: () => Promise<unknown[]>;
}) {
  async function loadAmazon(): Promise<EngineProduct[]> {
    let cached: { savedAt: number; rows: unknown[] } | null = null;
    try { cached = JSON.parse((await storage.getItem(catalogKey)) ?? 'null'); } catch { cached = null; }
    const usable = cached && Array.isArray(cached.rows) && cached.rows.length ? cached : null;
    let rows = usable && now() - usable.savedAt < DAY ? usable.rows : null;
    if (!rows) {
      try {
        rows = await fetchCatalog({ url, key, fetcher });
        await storage.setItem(catalogKey, JSON.stringify({ savedAt: now(), rows })).catch(() => {});
      } catch {
        if (!usable) throw new Error('상품 정보를 불러오지 못했어요.');
        rows = usable.rows;
      }
    }
    const today = todayKst(now());
    return rows!.map(row => toEngineProduct(row, today));
  }
  return {
    async load(): Promise<EngineProduct[]> {
      const choice = await source();
      const { source: chosen, apiBase } = typeof choice === 'string' ? { source: choice, apiBase: undefined } : choice;
      const today = todayKst(now());
      const amazon = chosen === 'web' ? [] : await loadAmazon();
      if (chosen === 'amazon') return amazon;
      if (!webItems) throw new Error('상품 정보를 불러오지 못했어요.');
      const web = (await webItems()).map(item => fromWebItem(item, today, { apiBase })) as EngineProduct[];
      return mergeCatalogs(amazon, web) as EngineProduct[];
    },
  };
}
