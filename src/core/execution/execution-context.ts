/**
 * Reads the execution context the GAP CLI injects into the spawned
 * Playwright process as env vars — generic, knows nothing about any
 * specific application. Tests/fixtures that need to know "which
 * application/module/profile is this run for" read it from here instead
 * of hardcoding it, so the same spec works under any application/profile
 * the CLI resolves.
 */
export interface ExecutionContext {
  application?: string;
  module?: string;
  dataProfile?: string;
  authProfile?: string;
}

export function getExecutionContext(): ExecutionContext {
  return {
    application: process.env.GAP_APPLICATION || undefined,
    module: process.env.GAP_MODULE || undefined,
    dataProfile: process.env.GAP_DATA_PROFILE || undefined,
    authProfile: process.env.GAP_AUTH_PROFILE || undefined,
  };
}
