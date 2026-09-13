export type PlistValue = string | number | boolean | string[] | number[];

export interface AndroidHostConfig {
  applicationId?: string;
  permissions?: string[];
}

export interface IosHostConfig {
  bundleIdentifier?: string;
  infoPlist?: Record<string, PlistValue>;
}

export type WxmpRenderer = 'webview' | 'skyline';

export interface WxmpHostConfig {
  appid?: string;
  renderer?: WxmpRenderer;
  /** project.config.json `setting` entries, merged over fjs's defaults
   * (key by key; yours win). */
  setting?: Record<string, unknown>;
}

export interface AppConfig {
  android?: AndroidHostConfig;
  ios?: IosHostConfig;
  wxmp?: WxmpHostConfig;
}

export declare function defineConfig<T extends AppConfig>(config: T): T;
