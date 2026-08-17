import { APIResponse } from '@playwright/test';
import { ApiClient } from '../../../src/core/http/api-client';

export interface LeaveApplication {
  startDate: string;
  endDate: string;
  reason: string;
}

/** Application-specific API client, the API equivalent of a Page Object — wraps the generic ApiClient, adds no framework logic. */
export class HrmsApiClient {
  constructor(private readonly client: ApiClient) {}

  login(username: string, password: string): Promise<APIResponse> {
    return this.client.post('/api/login', { data: { username, password } });
  }

  applyLeave(application: LeaveApplication): Promise<APIResponse> {
    return this.client.post('/api/leave/apply', { data: application });
  }

  listLeave(): Promise<APIResponse> {
    return this.client.get('/api/leave');
  }

  cancelLeave(id: string): Promise<APIResponse> {
    return this.client.post(`/api/leave/${id}/cancel`, {});
  }
}
