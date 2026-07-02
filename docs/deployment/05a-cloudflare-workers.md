# 05a Cloudflare Workers

This guide describes one deployment option for Shibboleth Link. Cloudflare is not required by the project, but this setup uses Workers, Workers Static Assets, and D1.

## Architecture

- Static Astro/Svelte frontend is deployed as Workers Static Assets from `client/dist`.
- The Worker script runs only for `/api/*`.
- Static routes such as `/`, `/link`, `/confirm`, and `/verify` are asset-first and do not invoke Worker compute.
- D1 stores flow/state/replay records, guild config, role mappings, server verification records, stored links, operator bans, and audit events.
- Runtime secrets are stored as Worker secrets, not committed files.

## Prerequisites

- Cloudflare account with access to the target zone.
- Node.js and npm.
- A Discord application and bot token.
- SAML SP private key and IdP certificate.
- IdP metadata/registration with the ACS callback URL.

## API Token Permissions

Create a Cloudflare API token with these permissions for deploys:

- `Account` -> `Workers Scripts` -> `Edit`
- `Account` -> `D1` -> `Edit`
- `Account` -> `Account Settings` -> `Read`
- `Zone` -> `Zone` -> `Read`
- `Zone` -> `Workers Routes` -> `Edit`

Optional, only if configuring WAF rules through the API:

- zone WAF/ruleset edit permissions

Set the token in your ignored root `.env`:

```bash
CLOUDFLARE_API_TOKEN=...
```

## Configure Worker Hostname

Update `server/wrangler.jsonc` for your hostname and zone. The Worker derives its public origin from the incoming request hostname, so for Cloudflare deployment the hostname is configured in one place: the Worker route pattern.

```json
"routes": [
  {
    "pattern": "shibboleth-link.example.com/*",
    "zone_name": "example.com"
  }
]
```

From that hostname, Shibboleth Link derives:

```text
https://shibboleth-link.example.com/api/discord/callback
https://shibboleth-link.example.com/api/saml/callback
```

The Discord Developer Portal must allow the derived Discord redirect URI.

The SAML IdP/SP registration must allow the derived SAML callback URL.

## Hostname Change Checklist

When moving Shibboleth Link to a new hostname, update these places:

- `server/wrangler.jsonc` Worker route `pattern`.
- Cloudflare DNS record for the hostname.
- Discord Developer Portal OAuth2 redirect URL: `https://<hostname>/api/discord/callback`.
- Discord Developer Portal Interactions Endpoint URL: `https://<hostname>/api/discord/interactions/callback`.
- SAML IdP/SP ACS callback URL: `https://<hostname>/api/saml/callback`.
- Optional Cloudflare WAF/custom rule host expression, if configured.

The app derives `APP_ORIGIN`, `DISCORD_REDIRECT_URI`, and `SAML_CALLBACK_URL` from the request hostname in Cloudflare Workers. The static client uses same-origin API calls by default.

## DNS

The Worker route hostname needs a proxied DNS record in Cloudflare.

For an originless Worker hostname:

```text
Type: AAAA
Name: shibboleth-link
Content: 100::
Proxy status: Proxied
TTL: Auto
```

The `100::` placeholder is a standard Cloudflare originless record used when a proxied hostname only routes to Workers.

## D1

Create the database:

```bash
cd server
npx wrangler d1 create shibboleth-link
```

Copy the returned `database_id` into `server/wrangler.jsonc`.

Apply migrations:

```bash
npm run db:migrate:remote
```

## One-Time Runtime Binding Setup

Worker runtime bindings persist in Cloudflare after they are set. Configure them once, and re-run this step only when a secret or runtime config value changes.

The setup helper stores these values as Worker secrets so deploys do not need to resend runtime configuration every time:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_PUBLIC_KEY`
- `JWT_SECRET`
- `SAML_ENTRY_POINT`
- `SAML_ISSUER`
- `SAML_IDP_CERT`
- `SAML_SP_PRIVATE_KEY`
- `OPERATOR_GUILD_ID`, if operator commands are enabled
- `OPERATOR_CHANNEL_ID`, if operator commands are enabled

Set runtime bindings from the ignored repo-root `.env` and optional `server/data/shibboleth/` files:

```bash
cd server
npm run worker:secrets:set
```

The helper passes secret values to Wrangler over stdin and does not print them.

`server/wrangler.jsonc` intentionally keeps `vars` empty. `npm run worker:deploy` deploys code and assets only; it does not update runtime bindings. For GitHub Actions deploys, the action only needs a Cloudflare API token with deploy permissions as long as runtime bindings were already configured in Cloudflare.

## Client Configuration

Edit public frontend configuration in:

```text
client/src/lib/site.ts
```

Set deployment-specific public links such as:

- operator name and URL
- contact email
- Discord/community invite URL
- bot invite URL
- source URL

The static client uses same-origin API calls by default, so no public API hostname needs to be configured for Cloudflare deployment. Do not set `PUBLIC_API_BASE_URL` for normal Cloudflare production deployments; that public build variable controls where credentialed browser link and verification requests are sent.

Build the Astro site from `client/` if you want to verify frontend output directly:

```bash
cd client
npm install
npm run build
```

## Deploy

Deploy from `server/`:

```bash
npm run worker:deploy
```

This builds the Astro/Svelte client first, uploads `client/dist` as Workers Static Assets, then deploys the Worker script.

If you changed Discord, SAML, JWT, operator, or other runtime binding values, run `npm run worker:secrets:set` before or after deploy so the persisted Cloudflare bindings match the new configuration.

## Static Asset Routing

`server/wrangler.jsonc` configures:

```json
"assets": {
  "directory": "../client/dist",
  "binding": "ASSETS",
  "html_handling": "drop-trailing-slash",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

This means:

- `/api/*` invokes the Worker script.
- `/link`, `/confirm`, `/verify`, and other frontend routes are static assets.
- `/link/` redirects to `/link`.
- `/confirm/` redirects to `/confirm`.

Static asset requests should not incur Worker compute request costs.

## Scheduled Cleanup

The Cloudflare Worker includes an hourly scheduled trigger:

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

The scheduled handler deletes expired or completed transient records after a 24-hour safety retention window:

- `link_flows`
- `oauth_states`
- `saml_requests`
- `server_verification_flows`

It does not delete persistent records such as stored links, verifier records, bans, audit events, guild configuration, or role mappings.

## Optional Cloudflare Anti-Abuse Challenge

Use a Cloudflare WAF custom rule to challenge browser traffic before it reaches the Worker. This can avoid Worker and D1 usage for challenged requests.

Do not challenge callback routes. SAML uses a browser POST body from the IdP, and an interstitial challenge can break the flow.

Recommended expression:

```text
(http.host eq "shibboleth-link.example.com" and not (http.request.uri.path contains "/callback"))
```

Action:

```text
Managed Challenge
```

Dashboard steps, based on Cloudflare's [Create a custom rule in the dashboard](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/) docs:

1. In the Cloudflare dashboard, select the target zone.
2. Go to **Security** -> **Security rules**.
3. Select **Create rule** -> **Custom rules**.
4. Set **Rule name** to `Shibboleth Link anti-abuse challenge`.
5. Under **When incoming requests match**, choose **Edit expression**.
6. Paste the expression above.
7. Under **Then take action**, choose **Managed Challenge**.
8. Select **Deploy**.

## Verify

Check static frontend:

```bash
curl -I 'https://shibboleth-link.example.com/link?server=<guild-id>'
```

Check API:

```bash
curl 'https://shibboleth-link.example.com/api/health'
```

Run a browser test at:

```text
https://shibboleth-link.example.com/link?server=<guild-id>
```

For annual server verification, run `/verify-self` in Discord and open the returned browser flow. Use `/verify` to check progress.
