import { ctcdocsConfig } from '@ctcstack/ctcdocs/config';
import { defineConfig } from 'astro/config';

import siteConfig from './site.config.json' with { type: 'json' };
import { generatedRedirects } from './src/generated/redirects.ts';
import { generatedSidebar } from './src/generated/sidebar.ts';

export default defineConfig(
  ctcdocsConfig({
    siteConfig,
    sidebar: generatedSidebar,
    redirects: generatedRedirects,
    sidebarPrefix: [
      {
        label: 'Documentation',
        items: [
          { label: 'Home', link: '/' },
          { label: 'All documents', link: '/documents/' },
          { label: 'About this site', slug: 'about' },
        ],
      },
    ],
  }),
);
