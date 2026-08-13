import { faker } from '@faker-js/faker';
import { Post } from '../../src/api/endpoints/posts.endpoint';

/** Fluent builder for Post test data — sensible random defaults, override only what a test cares about. */
export class PostBuilder {
  private post: Post = {
    userId: faker.number.int({ min: 1, max: 10 }),
    title: faker.lorem.sentence(),
    body: faker.lorem.paragraph(),
  };

  withUserId(userId: number): this {
    this.post.userId = userId;
    return this;
  }

  withTitle(title: string): this {
    this.post.title = title;
    return this;
  }

  withBody(body: string): this {
    this.post.body = body;
    return this;
  }

  build(): Post {
    return { ...this.post };
  }
}
