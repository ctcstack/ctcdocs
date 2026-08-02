import { z } from 'zod';
export declare const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export declare const GOOGLE_DRIVE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
export declare const driveItemSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mimeType: z.ZodString;
    parents: z.ZodDefault<z.ZodArray<z.ZodString>>;
    modifiedTime: z.ZodISODateTime;
    createdTime: z.ZodISODateTime;
    trashed: z.ZodBoolean;
    webViewLink: z.ZodOptional<z.ZodURL>;
    shortcutDetails: z.ZodOptional<z.ZodObject<{
        targetId: z.ZodString;
        targetMimeType: z.ZodString;
    }, z.core.$strip>>;
    size: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DriveItem = z.infer<typeof driveItemSchema>;
export declare const driveFileListResponseSchema: z.ZodObject<{
    files: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        mimeType: z.ZodString;
        parents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        modifiedTime: z.ZodISODateTime;
        createdTime: z.ZodISODateTime;
        trashed: z.ZodBoolean;
        webViewLink: z.ZodOptional<z.ZodURL>;
        shortcutDetails: z.ZodOptional<z.ZodObject<{
            targetId: z.ZodString;
            targetMimeType: z.ZodString;
        }, z.core.$strip>>;
        size: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    nextPageToken: z.ZodOptional<z.ZodString>;
    incompleteSearch: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const sharedDriveResponseSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const rootFolderResponseSchema: z.ZodObject<{
    id: z.ZodString;
    driveId: z.ZodString;
    mimeType: z.ZodString;
    trashed: z.ZodBoolean;
}, z.core.$strip>;
