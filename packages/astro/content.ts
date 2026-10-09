import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { DOCUMENT_SOURCE_TYPES } from '@ctcstack/ctcdocs-core/document-format';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        sourceType: z
          .enum([...DOCUMENT_SOURCE_TYPES, 'manual', 'section-index'])
          .default('manual'),
        googleFileId: z.string().min(1).optional(),
        /*
         * The ID behind the page's permanent link, `/d/<short ID>/`. Absent
         * on pages generated before permanent links existed.
         */
        shortId: z
          .string()
          .regex(/^[0-9a-f]{6,64}$/u)
          .optional(),
        googleModifiedTime: z.iso.datetime().optional(),
        syncedAt: z.iso.datetime().optional(),
        contentHash: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/u)
          .optional(),
        folderPath: z.array(z.string()).optional(),
        /*
         * A section page's listing as data: what each entry is, and how many
         * documents a folder holds. Absent on pages generated before it
         * existed, which then show their Markdown list.
         */
        entries: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({
                kind: z.literal('folder'),
                slug: z.string().min(1),
                documentCount: z.number().int().nonnegative(),
              }),
              z.object({
                kind: z.literal('document'),
                slug: z.string().min(1),
              }),
            ]),
          )
          .optional(),
        /*
         * A page that publishes a PDF (ADR-027): the file's name in the
         * page's asset directory when the site serves it, its size and its
         * page count.
         */
        pdf: z
          .object({
            file: z.string().optional(),
            bytes: z.number().int().nonnegative(),
            pages: z.number().int().nonnegative().nullable(),
          })
          .optional(),
        /*
         * A page that publishes a spreadsheet (ADR-046): how many sheets and
         * formulas it shows.
         */
        sheet: z
          .object({
            sheets: z.number().int().nonnegative(),
            formulas: z.number().int().nonnegative(),
            // A Google Sheet; absent from a page written before 0.22.1.
            googleSheet: z.boolean().optional(),
          })
          .optional(),
        /*
         * The page of a video or audio file (ADR-047): its kind, and its
         * length and frame size when Drive reports them.
         */
        media: z
          .object({
            kind: z.enum(['video', 'audio']),
            vids: z.boolean(),
            seconds: z.number().int().positive().nullable(),
            width: z.number().int().positive().nullable(),
            height: z.number().int().positive().nullable(),
          })
          .optional(),
        pagefind: z.boolean().default(true),
      }),
    }),
  }),
};
