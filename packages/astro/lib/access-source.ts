/**
 * The access classes of this build's corpus (ADR-039).
 *
 * Read once, at build time, from the project configuration and the sync
 * manifest, so every page that decides what to show about a document decides
 * it from the same model. Without an `access` section every class is the
 * members class and nothing changes.
 */
import {
  accessFindings,
  computeAccessModel,
  documentClass,
  findProjectRoot,
  folderClass,
  MEMBERS_CLASS,
  readCorpusStructure,
  type AccessFinding,
  type AccessModel,
} from '@ctcstack/ctcdocs-core';

import { siteConfiguration } from './project.js';

const corpus = readCorpusStructure(findProjectRoot());

const accessModel: AccessModel = computeAccessModel(
  siteConfiguration.access,
  corpus,
);

/** The Drive folder the sync reads; documents directly in it have no folder. */
export const rootFolderId: string | null = corpus.rootFolderId;

/** Folders closed for want of a rule, and rules that drifted, for review. */
export const folderAccessFindings: readonly AccessFinding[] =
  siteConfiguration.access
    ? accessFindings(siteConfiguration.access, corpus)
    : [];

const folderIdsBySlug = new Map(
  [...corpus.folders.values()].flatMap((folder) =>
    folder.slug ? [[folder.slug, folder.id] as const] : [],
  ),
);

/** A document's class, by its Drive ID. */
export function classOfDocument(fileId: string | undefined): string {
  return documentClass(accessModel, fileId);
}

/** A folder's class, by its address. */
export function classOfFolderSlug(slug: string): string {
  return folderClass(accessModel, folderIdsBySlug.get(slug));
}

/** Whether every signed-in member may read a document. */
export function isOpenToMembers(fileId: string | undefined): boolean {
  return classOfDocument(fileId) === MEMBERS_CLASS;
}
