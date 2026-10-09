import { describe, expect, it } from 'vitest';

import {
  agentDocumentFormat,
  DOCUMENT_FORMATS,
  DOCUMENT_SOURCE_TYPES,
  documentFormatOf,
  documentSourceType,
  isDocumentSourceType,
} from './document-format.js';

describe('document formats', () => {
  it('round-trips every format through its sourceType', () => {
    for (const format of DOCUMENT_FORMATS) {
      const sourceType = documentSourceType(format);
      expect(isDocumentSourceType(sourceType)).toBe(true);
      expect(
        documentFormatOf(
          sourceType,
          format === 'video' || format === 'audio' ? format : undefined,
        ),
      ).toBe(format);
    }
  });

  it('gives every sourceType a format', () => {
    expect(
      DOCUMENT_SOURCE_TYPES.map((sourceType) =>
        documentFormatOf(sourceType, 'audio'),
      ),
    ).toEqual(['google-doc', 'pdf', 'sheet', 'audio']);
  });

  it('leaves out pages no Drive file made', () => {
    for (const sourceType of ['manual', 'section-index', undefined]) {
      expect(isDocumentSourceType(sourceType)).toBe(false);
      expect(documentFormatOf(sourceType)).toBeUndefined();
    }
  });

  it('calls a Google Doc `doc` for assistants', () => {
    expect(agentDocumentFormat('google-doc')).toBe('doc');
    expect(agentDocumentFormat('video')).toBe('video');
  });
});
