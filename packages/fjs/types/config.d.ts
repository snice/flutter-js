export type PlistValue = string | number | boolean | string[] | number[];

export interface AndroidHostConfig {
  applicationId?: string;
  permissions?: string[];
}

export interface IosHostConfig {
  bundleIdentifier?: string;
  infoPlist?: Record<string, PlistValue>;
}

export interface AppConfig {
  android?: AndroidHostConfig;
  ios?: IosHostConfig;
}

export declare function defineConfig<T extends AppConfig>(config: T): T;
