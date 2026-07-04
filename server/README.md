# Shibboleth Link Server

This package contains the runtime-neutral Hono API for Shibboleth Link. The same core application can run as a Cloudflare Worker or as a local Node service.

Deployment guides:

- [Deployment overview](../docs/deployment/README.md)
- [Cloudflare Workers](../docs/deployment/05a-cloudflare-workers.md)
- [Self-hosted](../docs/deployment/05b-self-hosted.md)

## Runtime Targets

- `src/worker.ts`: Cloudflare Worker entrypoint using D1 and Workers Static Assets.
- `src/node.ts`: local/self-hosted Node entrypoint using SQLite.
- `src/app.ts`: shared Hono application.

## Storage

Storage adapters live in `src/storage/`:

- `d1.ts`: Cloudflare D1.
- `sqlite.ts`: local/self-hosted SQLite.
- `memory.ts`: development/testing fallback.

Migrations live in `migrations/` and define:

- link flows
- OAuth/SAML state
- SAML replay records
- guild configuration
- role mappings
- server verification flows/verifiers
- stored links
- operator bans
- audit events

Cloudflare Workers run an hourly scheduled cleanup for transient rows older than the 24-hour retention window:

- link flows
- OAuth states
- SAML replay requests
- server verification flows

The cleanup does not delete stored links, verifier records, bans, audit events, guild configuration, or role mappings.

## Important Routes

- `/api/health`
- `/api/link/session`
- `/api/link/confirm`
- `/api/saml/start`
- `/api/saml/callback`
- `/api/discord/start`
- `/api/discord/callback`
- `/api/discord/interactions/callback`
- `/api/verify/session`
- `/api/verify/confirm`

## Environment

Required secrets/config are documented in the deployment guides. At runtime, the API expects:

- Discord bot token, client ID, client secret, and public key.
- Cookie encryption secret.
- SAML IdP certificate and SP private key.
- SAML entry point and issuer.
- Operator guild/channel IDs if operator commands are enabled.

Use the root `.env` file for local/self-hosted configuration, Discord command registration, Worker secret upload, and Worker plaintext variable injection. True Worker secrets are populated with `npm run worker:secrets:set`; plaintext Worker vars are injected during `npm run worker:deploy`.

In Cloudflare Workers, the public app origin is derived from the incoming request hostname. Discord and SAML callback URLs default to paths under that origin:

```text
${APP_ORIGIN}/api/discord/callback
${APP_ORIGIN}/api/saml/callback
```

For Node/self-hosted deployments, set `APP_ORIGIN` in the environment.

## Commands

Register Discord commands from `server/`:

```bash
npm run discord:commands:register
```

This registers normal server commands globally and operator commands only in `OPERATOR_GUILD_ID`.

## Local Development

Install dependencies:

```bash
npm install
```

Run the API locally:

```bash
npm run dev
```

Build/typecheck:

```bash
npm run typecheck
npm run build
```

SQLite migrations run automatically on Node startup. Cloudflare D1 migrations are applied with Wrangler:

```bash
npm run db:migrate:remote
```

## Privacy/Security Model

- Pre-confirm identity is stored only in encrypted short-lived HttpOnly cookies.
- Confirm Only clears identity cookies and does not persist account links after confirmation.
- Link and Store persists server-scoped Discord user ID, NetID, affiliations, and timestamps.
- Verified Server status gates NetID-revealing lookup/export features.
- `/lookup` can be run outside the configured admin channel, but those responses are ephemeral; `/export` and `/delete-links` require the admin channel.
- Discord interactions are verified with Ed25519 request signatures.
- OAuth/SAML state and SAML request IDs prevent replay and account mix-up.
- Operator bans can block Discord users, Discord servers, or UIUC NetIDs.
