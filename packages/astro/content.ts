import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        sourceType: z
          .enum(['google-doc', 'manual', 'section-index'])
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
        pagefind: z.boolean().default(true),
      }),
    }),
  }),
};
