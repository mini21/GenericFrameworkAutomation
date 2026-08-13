import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';

// Validates the file-upload utility path (page.setInputFiles) against a
// public practice site.
test.describe('File upload', () => {
  test(`uploads a file ${TAGS.E2E}`, { tag: ['@file.upload'] }, async ({ uploadPage }) => {
    const filePath = path.join(process.cwd(), 'test-data', 'static', 'users.json');

    await uploadPage.open();
    await uploadPage.uploadFile(filePath);

    expect(await uploadPage.getUploadedFileName()).toBe('users.json');
  });
});
