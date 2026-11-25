import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const cases = defineCollection({
  loader: glob({ base: './src/content/cases', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    headword: z.string(),
    relatedForms: z.array(z.string()).default([]),
    targetId: z.string(),
    caseNumber: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Joshua Callahan'),
    authorCitation: z.string().default('Callahan, Joshua'),
    authorOrcid: z.string().url().optional(),
    coAuthors: z
      .array(
        z.object({
          name: z.string(),
          citationName: z.string(),
          orcid: z.string().url().optional(),
        })
      )
      .default([]),
    reviewedBy: z.string().optional(),
    reviewUrl: z.string().url().optional(),
    keywords: z.array(z.string()).default([]),
    oedBaseline: z.object({
      form: z.string(),
      year: z.number(),
      source: z.string(),
      url: z.string().url(),
    }),
    priorArtNote: z.string().optional(),
    earliestScan: z.object({
      form: z.string(),
      date: z.string(),
      year: z.number(),
      source: z.string(),
      location: z.string(),
      archiveUrl: z.string().url(),
      certId: z.string(),
    }),
    netDeltaLabel: z.string(),
    certificateCounts: z.object({
      total: z.number(),
      verified: z.number(),
      hypotheses: z.number(),
      falsified: z.number(),
    }),
    establishedFacts: z.array(z.string()),
    originHypothesis: z.object({
      badge: z.string(),
      summary: z.string(),
      boundaryNote: z.string(),
    }),
    proofPlates: z.array(
      z.object({
        certId: z.string(),
        title: z.string(),
        date: z.string(),
        imagePath: z.string(),
        archiveUrl: z.string().url(),
        caption: z.string(),
        diplomaticQuote: z.string(),
      })
    ),
    falsifiedMyths: z.array(
      z.object({
        certId: z.string(),
        claim: z.string(),
        trapType: z.string(),
        inkReality: z.string(),
        sourceUrl: z.string().url().optional(),
      })
    ),
    ledgerPath: z.string(),
    monographLabel: z.string().optional(),
    zenodoDoi: z.string().optional(),
    pdfUrl: z.string().url().optional(),
    reuseKit: z.object({
      wikipediaPrimaryRef: z.string(),
      wikipediaGuidance: z.string(),
      wiktionaryQuote: z.string(),
      adsLDispatch: z.string(),
      oedSlipSummary: z.string(),
    }),
  }),
});

export const collections = { cases };
