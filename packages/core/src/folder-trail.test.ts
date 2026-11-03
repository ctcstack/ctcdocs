import { describe, expect, it } from 'vitest';

import { folderTrailText, ROOT_FOLDER_LABEL } from './folder-trail.js';

describe('folderTrailText', () => {
  it('joins the folders outermost first', () => {
    expect(folderTrailText(['Team', 'Sales'])).toBe('Team › Sales');
  });

  it('names the top of the published folders', () => {
    expect(folderTrailText([])).toBe(ROOT_FOLDER_LABEL);
  });
});
