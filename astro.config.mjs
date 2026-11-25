import { defineConfig } from 'astro/config';
import { validateSite } from './scripts/validate-site.mjs';

// Update SITE_URL via environment variable or edit directly once your Cloudflare domain is live.
const siteUrl = process.env.SITE_URL || 'https://dragnet.tch.one';

function dragnetBuildGate() {
  return {
    name: 'dragnet-schema-and-rights-gate',
    hooks: {
      'astro:build:start': () => {
        const result = validateSite();
        if (!result.ok) {
          const msg = result.errors.map((e) => `  - ${e}`).join('\n');
          throw new Error(`DRAgNEt pre-build validation failed (${result.errors.length} error(s)):\n${msg}`);
        }
        console.log(
          `[DRAgNEt Gate] Verified ${result.stats.cases} case files, ${result.stats.citations} citations, and ${result.stats.hostedScans} pre-1931 scans.`
        );
      },
    },
  };
}

export default defineConfig({
  site: siteUrl,
  output: 'static',
  integrations: [dragnetBuildGate()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
