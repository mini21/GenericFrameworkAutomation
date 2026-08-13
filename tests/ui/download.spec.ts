import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';

// Validates the file-download utility path (page.waitForEvent('download'))
// against a public practice site.
test.describe('File download', () => {
  test(`downloads a file ${TAGS.E2E}`, { tag: ['@file.download'] }, async ({ downloadPage }) => {
    await downloadPage.open();
    const download = await downloadPage.downloadFirstFile();

    expect(download.suggestedFilename()).toBeTruthy();
  });
});
