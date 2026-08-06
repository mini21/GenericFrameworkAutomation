import { config, AppConfig, Environment } from '../../../config/env.config';

export class EnvironmentManager {
  private static readonly appConfig: AppConfig = config;

  static get environment(): Environment {
    return this.appConfig.env;
  }

  static get baseUrl(): string {
    return this.appConfig.baseUrl;
  }

  static get apiBaseUrl(): string {
    return this.appConfig.apiBaseUrl;
  }

  static get logLevel(): string {
    return this.appConfig.logLevel;
  }

  static isCI(): boolean {
    return Boolean(process.env.CI);
  }

  static isDev(): boolean {
    return this.environment === 'dev';
  }

  static isQA(): boolean {
    return this.environment === 'qa';
  }

  static isStaging(): boolean {
    return this.environment === 'staging';
  }

  static isProd(): boolean {
    return this.environment === 'prod';
  }
}
