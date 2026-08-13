import { test, expect } from '../../src/core/fixtures/base.fixture';
import { PostsApi } from '../../src/api/endpoints/posts.endpoint';
import { PostBuilder } from '../../test-data/factories/post.builder';
import { createUser } from '../../test-data/factories/user.factory';
import { loadStaticData } from '../../test-data/utils/static-data.util';
import { getEnvData } from '../../test-data/utils/env-data.util';
import { TAGS } from '../../src/core/constants';

interface StaticUser {
  id: number;
  role: string;
  name: string;
}

const staticUsers = loadStaticData<StaticUser[]>('users.json');

test.describe('Posts API — data-driven', () => {
  // Parameterized over static JSON test data.
  for (const user of staticUsers) {
    test(`creates a post for static user "${user.name}" ${TAGS.REGRESSION}`, async ({ api }) => {
      const postsApi = new PostsApi(api);
      const post = new PostBuilder().withUserId(user.id).withTitle(`Post by ${user.name}`).build();

      const response = await postsApi.create(post);
      const created = await response.json();

      expect(response.status()).toBe(201);
      expect(created.userId).toBe(user.id);
    });
  }

  test(`creates a post using Faker-generated dynamic data ${TAGS.SMOKE}`, async ({ api }) => {
    const dynamicUser = createUser();
    const postsApi = new PostsApi(api);
    const post = new PostBuilder().withTitle(`Dynamic post for ${dynamicUser.username}`).build();

    const response = await postsApi.create(post);
    const created = await response.json();

    expect(response.status()).toBe(201);
    expect(created.title).toContain(dynamicUser.username);
  });

  test(`resolves environment-specific test data ${TAGS.SMOKE}`, async () => {
    const envData = getEnvData<{ expectedWelcomeMessage: string }>();
    expect(envData.expectedWelcomeMessage).toContain('Welcome');
  });
});
