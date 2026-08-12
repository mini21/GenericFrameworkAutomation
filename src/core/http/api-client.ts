import { APIRequestContext, APIResponse } from '@playwright/test';
import { logger } from '../logger/logger';
import { retry } from '../utils/wait.util';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
  failOnStatusCode?: boolean;
  /** Retries on 5xx responses or network errors. Omit/0 to disable. */
  retries?: number;
  retryDelayMs?: number;
}

/** Thrown for network failures or, when `retries` is set, exhausted 5xx retries. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly url: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thin wrapper over Playwright's APIRequestContext: adds request/response
 * logging, retry-on-5xx, and consistent error wrapping on top of whatever
 * base URL and default headers the context was created with (see
 * api.fixture.ts). No separate HTTP library — this is the API automation
 * engine.
 */
export class ApiClient {
  constructor(private readonly context: APIRequestContext) {}

  get(url: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request('GET', url, options);
  }

  post(url: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request('POST', url, options);
  }

  put(url: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request('PUT', url, options);
  }

  patch(url: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request('PATCH', url, options);
  }

  delete(url: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request('DELETE', url, options);
  }

  private request(
    method: HttpMethod,
    url: string,
    options: ApiRequestOptions,
  ): Promise<APIResponse> {
    const attempt = async (): Promise<APIResponse> => {
      const start = Date.now();
      logger.info(`API ${method} ${url}`, { params: options.params, data: options.data });

      let response: APIResponse;
      try {
        response = await this.context.fetch(url, {
          method,
          headers: options.headers,
          params: options.params,
          data: options.data,
          failOnStatusCode: options.failOnStatusCode ?? false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`API ${method} ${url} failed`, { error: message });
        throw new ApiError(message, method, url);
      }

      logger.info(`API ${method} ${url} -> ${response.status()}`, {
        durationMs: Date.now() - start,
      });

      if (options.retries && response.status() >= 500) {
        throw new ApiError(`Server error ${response.status()}`, method, url, response.status());
      }

      return response;
    };

    if (options.retries) {
      return retry(attempt, { retries: options.retries, delayMs: options.retryDelayMs ?? 1000 });
    }
    return attempt();
  }
}
