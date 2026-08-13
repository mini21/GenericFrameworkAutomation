import { Page } from '@playwright/test';
import * as path from 'path';
import { ensureDir } from './file.util';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'reports', 'screenshots');

/** On-demand capture beyond Playwright's automatic failure-only screenshots. */
export async function captureScreenshot(page: Page, name: string): Promise<string> {
  ensureDir(SCREENSHOT_DIR);
  const filePath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}
