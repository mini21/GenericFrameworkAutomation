import { test as base } from '@playwright/test';
import { UiActions } from '../locator/ui-actions';

// Independent of any page object / application — just page + testInfo.
export const test = base.extend<{ ui: UiActions }>({
  ui: async ({ page }, use, testInfo) => {
    await use(new UiActions(page, testInfo));
  },
});

export { expect } from '@playwright/test';
