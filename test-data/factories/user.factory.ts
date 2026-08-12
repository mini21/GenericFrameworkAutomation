import { faker } from '@faker-js/faker';

export interface TestUser {
  id: string;
  name: string;
  email: string;
  username: string;
}

/** Faker-backed dynamic data — unique per call, safe for parallel execution. */
export function createUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    username: faker.internet.username(),
    ...overrides,
  };
}
