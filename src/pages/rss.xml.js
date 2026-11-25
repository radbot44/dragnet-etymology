import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import MarkdownIt from 'markdown-it';
import { SITE_ACRONYM, SITE_EXPANDED, SITE_LICENSE_URL, SITE_TAGLINE } from '../consts';

const parser = new MarkdownIt({ html: false, linkify: true });

export async function GET(context) {
  const cases = (await getCollection('cases')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  return rss({
    title: `${SITE_ACRONYM} — ${SITE_EXPANDED}`,
    description: `${SITE_TAGLINE} Licensed under CC BY 4.0 (${SITE_LICENSE_URL}).`,
    site: context.site,
    xmlns: {
      dc: 'http://purl.org/dc/elements/1.1/',
    },
    customData: `<language>en-us</language><copyright>CC BY 4.0 (${SITE_LICENSE_URL})</copyright>`,
    items: cases.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.pubDate,
      description: entry.data.subtitle,
      author: entry.data.author,
      categories: entry.data.keywords,
      link: `/cases/${entry.id}/`,
      content: parser.render(entry.body || ''),
      customData: `<dc:creator>${entry.data.author}</dc:creator><dc:rights>${SITE_LICENSE_URL}</dc:rights>`,
    })),
  });
}
