import { createApp } from './app.js';
import type { WorkerBindings } from './bindings.js';
import { loadEnv } from './env.js';
import { withSecurityHeaders } from './http.js';
import { D1Storage } from './storage/d1.js';

const TRANSIENT_RETENTION_MS = 24 * 60 * 60 * 1000;

export default {
  fetch(request: Request, bindings: WorkerBindings, executionContext: ExecutionContext) {
    const env = loadEnv({
      ...(bindings as unknown as Record<string, string | undefined>),
      APP_ORIGIN: bindings.APP_ORIGIN ?? new URL(request.url).origin,
    });
    const storage = new D1Storage(bindings.DB);
    const app = createApp(env, storage);
    if (new URL(request.url).pathname.startsWith('/api/')) {
      return app.fetch(request, bindings, executionContext);
    }
    return bindings.ASSETS.fetch(request).then(withSecurityHeaders);
  },

  async scheduled(_event: ScheduledController, bindings: WorkerBindings) {
    const storage = new D1Storage(bindings.DB);
    const cutoff = Date.now() - TRANSIENT_RETENTION_MS;
    const result = await storage.cleanupTransientRows(cutoff);
    console.log('Transient cleanup complete', result);
  },
};
