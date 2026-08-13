import { test, expect } from '../../src/core/fixtures/base.fixture';
import { PostsApi } from '../../src/api/endpoints/posts.endpoint';
import { TAGS } from '../../src/core/constants';
import { expectStatus, assertSchema } from '../../src/core/http/response-assertions';

// Validates the ApiClient + api fixture wiring (auth headers, retry,
// schema validation, error handling) against a public test API. Replace
// with specs for the real target API once one is chosen.
test.describe('Posts API', () => {
  test(`lists posts ${TAGS.SMOKE}`, async ({ api }) => {
    const postsApi = new PostsApi(api);

    const response = await postsApi.list();
    await expectStatus(response, 200);

    const posts = await response.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    assertSchema(posts[0], { id: 'number', userId: 'number', title: 'string', body: 'string' });
  });

  test(`fetches a single post by id, with retry enabled ${TAGS.SMOKE}`, async ({ api }) => {
    const postsApi = new PostsApi(api);

    const response = await postsApi.getById(1, { retries: 2 });
    await expectStatus(response, 200);

    const post = await response.json();
    assertSchema(post, { id: 'number', userId: 'number', title: 'string', body: 'string' });
    expect(post.id).toBe(1);
  });

  test(`creates a post ${TAGS.REGRESSION}`, async ({ api }) => {
    const postsApi = new PostsApi(api);

    const response = await postsApi.create({
      userId: 1,
      title: 'Framework smoke test',
      body: 'Validates POST wiring through ApiClient.',
    });
    await expectStatus(response, 201);

    const created = await response.json();
    expect(created.title).toBe('Framework smoke test');
  });

  test(`returns 404 for a nonexistent post ${TAGS.REGRESSION}`, async ({ api }) => {
    const postsApi = new PostsApi(api);

    const response = await postsApi.getById(999_999);
    expect(response.status()).toBe(404);
  });
});
