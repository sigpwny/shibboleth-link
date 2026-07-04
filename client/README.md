# Shibboleth Link Client

This package contains the static Astro/Svelte frontend for Shibboleth Link.

## Stack

- Astro v7.
- Svelte islands.
- Tailwind CSS.
- Static output served by Cloudflare Workers Static Assets or any self-hosted static file server.

## Pages

- `/`: FAQ and bot invite page.
- `/link?server=<guild-id>`: user linking flow.
- `/confirm`: link success/expired result page.
- `/verify?flow=<flow-id>`: server administrator verification browser flow.
- `/privacy`: privacy policy.
- `/terms`: terms of service.
- `/contact`: contact information.

## Development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

By default, production builds use same-origin API calls. For local development with the API on a different port, set this in the root `.env` or your shell:

```bash
PUBLIC_API_BASE_URL=http://localhost:8787
```

`PUBLIC_API_BASE_URL` is security-sensitive public build configuration. It controls where the browser sends credentialed link and verification requests. Production builds should normally leave it unset so API calls stay same-origin, unless the deployment intentionally uses a separate API origin with matching server-side CORS configuration.

Build and check:

```bash
npm run build
```

## Configuration

Shared frontend constants live in:

```text
src/lib/site.ts
```

This includes public URLs such as the bot invite URL, contact URL, source URL, and policy pages.

The deployed hostname is not hardcoded in the client. The link and verify pages use same-origin API requests unless `PUBLIC_API_BASE_URL` is explicitly set at build time.
