// Product search for the shopping agent, through Channel3's /v1/search. Each result is a canonical
// product with one offer per retailer. We flatten that into one candidate per in-stock offer, priced
// in cents, so the agent compares retailers and the policy engine sees a merchant and an amount.

import type { Cents } from './policy.ts';

export type Candidate = {
  productId: string;
  title: string;
  brand?: string;
  merchant: string; // the retailer domain, e.g. bestbuy.com
  category?: string;
  priceCents: Cents;
  currency: string;
  buyUrl: string;
  imageUrl?: string;
};

type RawOffer = { domain?: string; price?: { price?: number; currency?: string }; availability?: string; url?: string };
type RawProduct = {
  id?: string;
  title?: string;
  brands?: { name?: string }[];
  category?: { title?: string };
  images?: { url?: string; is_main_image?: boolean }[];
  offers?: RawOffer[];
};

export function flattenProducts(products: RawProduct[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of products) {
    if (!p.id || !p.title) continue;
    for (const offer of p.offers ?? []) {
      const amount = offer.price?.price;
      if (!offer.domain || typeof amount !== 'number' || !offer.url) continue;
      if (offer.availability && offer.availability !== 'InStock') continue;
      out.push({
        productId: p.id,
        title: p.title,
        brand: p.brands?.[0]?.name,
        merchant: offer.domain,
        category: p.category?.title,
        priceCents: Math.round(amount * 100),
        currency: offer.price?.currency ?? 'USD',
        buyUrl: offer.url,
        imageUrl: (p.images?.find((i) => i.is_main_image) ?? p.images?.[0])?.url,
      });
    }
  }
  return out;
}

export async function searchProducts(query: string, opts: { maxPriceDollars?: number; limit?: number } = {}): Promise<Candidate[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error('CHANNEL3_API_KEY is not set');
  const body: Record<string, unknown> = { query, limit: opts.limit ?? 8 };
  const filters: Record<string, unknown> = { availability: ['InStock'] };
  if (opts.maxPriceDollars) filters.price = { max_price: opts.maxPriceDollars };
  body.filters = filters;
  const res = await fetch('https://api.trychannel3.com/v1/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Channel3 search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { products?: RawProduct[] } | RawProduct[];
  return flattenProducts(Array.isArray(json) ? json : (json.products ?? []));
}
