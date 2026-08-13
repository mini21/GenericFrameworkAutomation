import { EnvironmentManager } from '../../src/core/config/environment-manager';
import { loadStaticData } from './static-data.util';

type EnvDataMap = Record<string, Record<string, unknown>>;

/** Returns the env-data.json entry for the currently configured environment. */
export function getEnvData<T = Record<string, unknown>>(): T {
  const data = loadStaticData<EnvDataMap>('env-data.json');
  const entry = data[EnvironmentManager.environment];
  if (!entry) {
    throw new Error(
      `No env-data.json entry for environment "${EnvironmentManager.environment}". ` +
        `Add one alongside the other environments in test-data/static/env-data.json.`,
    );
  }
  return entry as T;
}
