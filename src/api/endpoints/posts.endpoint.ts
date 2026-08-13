import { APIResponse } from '@playwright/test';
import { ApiClient, ApiRequestOptions } from '../../core/http/api-client';

export interface Post {
  id?: number;
  userId: number;
  title: string;
  body: string;
}

/**
 * Example endpoint client against the public jsonplaceholder test API.
 * Validation scaffolding for the HTTP client + api fixture — replace with
 * real resource clients once a target application/API is chosen.
 */
export class PostsApi {
  constructor(private readonly client: ApiClient) {}

  list(options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.client.get('/posts', options);
  }

  getById(id: number, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.client.get(`/posts/${id}`, options);
  }

  create(post: Post, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.client.post('/posts', { ...options, data: post });
  }
}
