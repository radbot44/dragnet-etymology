import { defineConfig } from 'astro/config';

// Update SITE_URL via environment variable or edit directly once your Cloudflare domain is live.
const siteUrl = process.env.SITE_URL || 'https://dragnet.tch.one';

export default defineConfig({
  site: siteUrl,
  output: 'static',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
