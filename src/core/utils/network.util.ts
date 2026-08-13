import { Page, Route } from '@playwright/test';

/** Fulfills any request matching urlPattern with a fixed JSON body — isolates UI tests from flaky/unavailable backends. */
export async function mockJsonRoute(
  page: Page,
  urlPattern: string | RegExp,
  jsonBody: unknown,
  status = 200,
): Promise<void> {
  await page.route(urlPattern, (route: Route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(jsonBody) }),
  );
}
