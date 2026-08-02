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
        googleModifiedTime: z.iso.datetime().optional(),
        syncedAt: z.iso.datetime().optional(),
        contentHash: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/u)
          .optional(),
        folderPath: z.array(z.string()).optional(),
        pagefind: z.boolean().default(true),
      }),
    }),
  }),
};
