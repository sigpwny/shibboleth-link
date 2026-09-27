import { createApp } from './app.js';
import type { WorkerBindings } from './bindings.js';
import { loadEnv } from './env.js';
import { withSecurityHeaders } from './http.js';
import { D1Storage } from './storage/d1.js';
import { sendVerificationReminders, VERIFICATION_EXPIRATION_CRON, VERIFICATION_OPENING_CRON } from './verify/reminders.js';

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

  async scheduled(event: ScheduledController, bindings: WorkerBindings) {
    const storage = new D1Storage(bindings.DB);
    switch (event.cron) {
      case '0 * * * *': {
        const cutoff = Date.now() - TRANSIENT_RETENTION_MS;
        const result = await storage.cleanupTransientRows(cutoff);
        console.log('Transient cleanup complete', result);
        break;
      }
      case VERIFICATION_OPENING_CRON:
      case VERIFICATION_EXPIRATION_CRON: {
        event.noRetry();
        const env = loadEnv(bindings as unknown as Record<string, string | undefined>);
        const kind = event.cron === VERIFICATION_OPENING_CRON ? 'opening' : 'expiration';
        const result = await sendVerificationReminders(env, storage, kind, new Date(event.scheduledTime));
        console.log('Verification reminders complete', { kind, ...result });
        break;
      }
    }
  },
};
