import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_ACRONYM, SITE_EXPANDED } from '../../consts';

export async function getStaticPaths() {
  const cases = await getCollection('cases');
  return cases.map((entry) => ({
    params: { id: entry.id },
    props: { entry },
  }));
}

export const GET: APIRoute = ({ props, site }) => {
  const { entry } = props as any;
  const d = entry.data;
  const pubYear = d.pubDate.getUTCFullYear();
  const canonicalUrl = new URL(`/cases/${entry.id}/`, site).toString();
  const leadSurname = (d.authorCitation.split(',')[0] || 'author')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const allAuthors = [d.authorCitation, ...(d.coAuthors || []).map((c: any) => c.citationName)].join(' and ');
  const bib = `@techreport{${leadSurname}_${pubYear}_${entry.id.replace(/[^a-z0-9]/gi, '_')},
  author      = {${allAuthors}},
  title       = {{${d.title}}},
  institution = {${SITE_ACRONYM} --- ${SITE_EXPANDED}},
  year        = {${pubYear}},
  month       = {${d.pubDate.getUTCMonth() + 1}},
  number      = {${d.caseNumber} (${d.targetId})},
  url         = {${canonicalUrl}}${d.journalDoi ? `,\n  doi         = {${d.journalDoi}}` : ''}
}
`;
  return new Response(bib, {
    headers: {
      'Content-Type': 'application/x-bibtex; charset=utf-8',
    },
  });
};
