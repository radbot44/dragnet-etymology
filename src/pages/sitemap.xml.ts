import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const cases = await getCollection('cases');
  const base = site || new URL('https://dragnet-etymology.workers.dev');
  const urls = [
    new URL('/', base).toString(),
    new URL('/submit/', base).toString(),
    new URL('/about/', base).toString(),
    ...cases.map((c) => new URL(`/cases/${c.id}/`, base).toString()),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
