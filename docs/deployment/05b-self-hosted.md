# 05b Self-Hosted

This guide describes running Shibboleth Link without Cloudflare Workers. It uses the same Hono API code on Node.js, a static Astro/Svelte frontend, and local SQLite storage by default.

## Architecture

- Build the frontend from `client/` into `client/dist`.
- Run the API from `server/` with Node.js.
- Serve static files with Caddy, nginx, Apache, or another reverse proxy.
- Proxy `/api/*` to the Node API.
- Use SQLite for flow/state/replay records, guild config, role mappings, server verification records, stored links, operator bans, and audit events unless you add another storage adapter.

## Prerequisites

- Node.js 22 or newer.
- npm.
- HTTPS endpoint accepted by your SAML IdP.
- Discord application with OAuth redirect URL configured.
- SAML SP private key and IdP certificate.

## Environment

Copy `.env.example` to an ignored `.env` at the repo root and fill in deployment-specific values. The same root `.env` is used by local Node, command registration scripts, and Worker secret upload scripts.

Required values:

```bash
APP_ORIGIN=https://your-host.example
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_PUBLIC_KEY=...
JWT_SECRET=...
SAML_ENTRY_POINT=https://shibboleth.illinois.edu/idp/profile/SAML2/Redirect/SSO
SAML_ISSUER=https://your-host.example/shibboleth
PORT=8787
```

`DISCORD_REDIRECT_URI` and `SAML_CALLBACK_URL` default to paths under `APP_ORIGIN`:

```text
${APP_ORIGIN}/api/discord/callback
${APP_ORIGIN}/api/saml/callback
```

## Hostname Change Checklist

When moving Shibboleth Link to a new hostname, update these places:

- `APP_ORIGIN` in the deployment environment.
- Reverse proxy virtual host/server name.
- DNS record for the hostname.
- Discord Developer Portal OAuth2 redirect URL: `https://<hostname>/api/discord/callback`.
- Discord Developer Portal Interactions Endpoint URL: `https://<hostname>/api/discord/interactions/callback`.
- SAML IdP/SP ACS callback URL: `https://<hostname>/api/saml/callback`.
- Any anti-abuse/WAF/proxy allowlist rule matching the old host.

Only set `DISCORD_REDIRECT_URI` or `SAML_CALLBACK_URL` if you need to override the default paths derived from `APP_ORIGIN`.

SAML cert/key can be provided either as env vars:

```bash
SAML_IDP_CERT='-----BEGIN CERTIFICATE-----...'
SAML_SP_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...'
```

Or as files read by local Node startup:

```text
server/data/shibboleth/idp-cert.pem
server/data/shibboleth/sp-key.pem
```

These paths are ignored by git and excluded from Docker build contexts.

## Storage

Local Node uses SQLite by default:

```text
server/data/local.sqlite
```

Override with:

```bash
SQLITE_PATH=/var/lib/shibboleth-link/local.sqlite
```

The API applies unapplied SQL migrations automatically on startup.

Expired transient row cleanup is automatic in both supported runtime targets. Cloudflare Workers use the scheduled Worker trigger. The self-hosted Node entrypoint runs cleanup on startup and then hourly, deleting expired or completed transient records after the 24-hour safety retention window.

## Build

Edit public frontend configuration before building:

```text
client/src/lib/site.ts
```

Set deployment-specific public links such as:

- operator name and URL
- contact email
- Discord/community invite URL
- bot invite URL
- source URL

The static client uses same-origin API calls by default. If your self-hosted frontend and API are on different origins, set `PUBLIC_API_BASE_URL` before building the client. Treat `PUBLIC_API_BASE_URL` as security-sensitive public configuration: it controls where credentialed link and verification requests are sent, so production builds should use same-origin unless you intentionally operate a separate API origin and have configured CORS for exactly that origin.

Install dependencies and build both packages:

```bash
cd client
npm install
npm run build

cd ../server
npm install
npm run build
```

## Run API

From `server/`:

```bash
npm run start
```

For development:

```bash
npm run dev
```

The API listens on `PORT`, defaulting to `8787`.

## Reverse Proxy

Your proxy should:

- Serve `client/dist` as the web root.
- Proxy `/api/*` to `http://127.0.0.1:8787`.
- Preserve host/proto headers.
- Use HTTPS.
- Redirect trailing slashes for frontend pages if desired.

Example Caddyfile:

```caddyfile
your-host.example {
  root * /opt/shibboleth-link/client/dist
  encode zstd gzip

  handle /api/* {
    reverse_proxy 127.0.0.1:8787
  }

  try_files {path} {path}/index.html /index.html
  file_server
}
```

Example nginx sketch:

```nginx
server {
  listen 443 ssl http2;
  server_name your-host.example;

  root /opt/shibboleth-link/client/dist;

  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri $uri/index.html /index.html;
  }
}
```

## Process Management

Use systemd, Docker, or another supervisor to keep the API running.

Minimal systemd sketch:

```ini
[Unit]
Description=Shibboleth Link API
After=network.target

[Service]
WorkingDirectory=/opt/shibboleth-link/server
EnvironmentFile=/opt/shibboleth-link/.env
ExecStart=/usr/bin/npm run start
Restart=always
User=shibboleth-link

[Install]
WantedBy=multi-user.target
```

## Verify

Check frontend:

```bash
curl -I 'https://your-host.example/link?server=<guild-id>'
```

Check API:

```bash
curl 'https://your-host.example/api/health'
```

Run a browser test at:

```text
https://your-host.example/link?server=<guild-id>
```

For annual server verification, run `/verify-self` in Discord and open the returned browser flow. Use `/verify` to check progress.
