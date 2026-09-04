import type {
  AndroidHostConfig,
  AppConfig,
  IosHostConfig,
  PlistValue,
} from './project/config.js';

export type {
  AndroidHostConfig,
  AppConfig,
  IosHostConfig,
  PlistValue,
};

/** Adds editor/type-checking support to the root app.config.ts without
 * changing the config object at runtime. */
export function defineConfig<T extends AppConfig>(config: T): T {
  return config;
}
