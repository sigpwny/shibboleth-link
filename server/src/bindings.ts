import type { AppEnv } from './env.js';
import type { Storage } from './storage/types.js';

export interface AppBindings {
  Variables: {
    env: AppEnv;
    storage: Storage;
  };
}

export interface WorkerBindings extends Partial<AppEnv> {
  DB: D1Database;
  ASSETS: Fetcher;
}
