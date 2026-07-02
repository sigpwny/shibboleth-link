import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './bindings.js';
import type { AppEnv } from './env.js';
import { noStore, securityHeaders, withRuntime } from './http.js';
import { discordRoutes } from './routes/discord.js';
import { linkRoutes } from './routes/link.js';
import { samlRoutes } from './routes/saml.js';
import { verifyRoutes } from './routes/verify.js';
import type { Storage } from './storage/types.js';

export function createApp(env: AppEnv, storage: Storage) {
  const app = new Hono<AppBindings>();

  app.use('*', withRuntime(env, storage));
  app.use('*', securityHeaders);
  app.use('*', noStore);
  app.use('*', async (c, next) => {
    const env = c.get('env');
    return cors({
      origin: env.APP_ORIGIN,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })(c, next);
  });

  app.get('/', (c) => c.json({ name: 'Shibboleth Link API', status: 'ok' }));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/link', linkRoutes);
  app.route('/api/verify', verifyRoutes);
  app.route('/api/saml', samlRoutes);
  app.route('/api/discord', discordRoutes);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('Unhandled API error', {
      name: err instanceof Error ? err.name : 'unknown',
      message: err instanceof Error ? err.message : 'unknown',
      route: c.req.routePath,
    });
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
