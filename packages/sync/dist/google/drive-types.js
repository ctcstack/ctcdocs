import { z } from 'zod';
export const GOOGLE_DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
export const GOOGLE_DRIVE_DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document';
const googleDriveIdentifier = z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u, 'Invalid Google Drive identifier');
export const driveItemSchema = z.object({
    id: googleDriveIdentifier,
    name: z.string(),
    mimeType: z.string().min(1),
    parents: z.array(googleDriveIdentifier).default([]),
    modifiedTime: z.iso.datetime(),
    createdTime: z.iso.datetime(),
    trashed: z.boolean(),
    webViewLink: z.url().optional(),
    shortcutDetails: z
        .object({
        targetId: googleDriveIdentifier,
        targetMimeType: z.string().min(1),
    })
        .optional(),
    size: z.string().regex(/^\d+$/u).optional(),
});
export const driveFileListResponseSchema = z.object({
    files: z.array(driveItemSchema).default([]),
    nextPageToken: z.string().min(1).optional(),
    incompleteSearch: z.boolean().default(false),
});
export const sharedDriveResponseSchema = z.object({
    id: googleDriveIdentifier,
});
export const rootFolderResponseSchema = z.object({
    id: googleDriveIdentifier,
    driveId: googleDriveIdentifier,
    mimeType: z.string().min(1),
    trashed: z.boolean(),
});
