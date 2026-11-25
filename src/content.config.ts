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
    ledgerSlug: z.string(),
    publicationStatus: z.enum([
      'working_paper',
      'manuscript_in_preparation',
      'under_review',
      'published_article',
      'dictionary_submitted',
    ]),
    publicationStatusNote: z.string(),
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
    priorArtSummary: z.string(),
    earliestKnownAttestation: z.object({
      form: z.string(),
      dateDisplay: z.string(),
      year: z.number(),
      source: z.string(),
      citedIn: z.string(),
      url: z.string().url(),
      certId: z.string().optional(),
    }),
    earliestNewDiscovery: z.object({
      form: z.string(),
      dateDisplay: z.string(),
      year: z.number(),
      source: z.string(),
      location: z.string(),
      antedatingSummary: z.string(),
      archiveUrl: z.string().url(),
      certId: z.string(),
    }),
    establishedFacts: z.array(z.string()),
    originHypothesis: z.object({
      label: z.string(),
      summary: z.string(),
      boundaryNote: z.string(),
    }),
    chronologyTimeline: z.array(
      z.object({
        date: z.string(),
        form: z.string(),
        source: z.string(),
        note: z.string(),
        certId: z.string(),
      })
    ),
    featuredScanIds: z.array(z.string()),
    rejectedLeadIds: z.array(z.string()),
    openQuestions: z.array(z.string()).default([]),
    journalDoi: z.string().optional(),
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
