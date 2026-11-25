import { defineConfig } from 'astro/config';

// Update SITE_URL via environment variable or edit directly once your Cloudflare domain is live.
const siteUrl = process.env.SITE_URL || 'https://dragnet-etymology.workers.dev';

export default defineConfig({
  site: siteUrl,
  output: 'static',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
