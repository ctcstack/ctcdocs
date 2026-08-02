import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

interface AssetProps {
  mimeType: string;
  source: string;
}

const assetRoot = resolve('src/assets/generated');
const mimeTypes = new Map([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

export const getStaticPaths = (async () => {
  const entries = await getCollection(
    'docs',
    ({ data }) => data.sourceType === 'google-doc',
  );
  const paths = [];

  for (const { data } of entries) {
    if (!data.googleFileId) {
      throw new Error('Generated Google document is missing googleFileId.');
    }
    const documentRoot = join(assetRoot, data.googleFileId);
    let assets: Dirent[];
    try {
      assets = await readdir(documentRoot, { withFileTypes: true });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }

    for (const asset of assets.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (!asset.isFile()) {
        throw new Error(
          `Generated asset path is not a regular file: ${asset.name}`,
        );
      }
      const { name } = asset;
      const mimeType = mimeTypes.get(extname(name).toLocaleLowerCase('en'));
      if (!mimeType) {
        throw new Error(
          `Generated asset has an unsupported extension: ${name}`,
        );
      }
      paths.push({
        params: { documentId: data.googleFileId, asset: name },
        props: {
          mimeType,
          source: join(documentRoot, name),
        } satisfies AssetProps,
      });
    }
  }

  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute<AssetProps> = async ({ props }) => {
  const bytes = await readFile(props.source);
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': props.mimeType },
  });
};
