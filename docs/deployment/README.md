# Shibboleth Link Deployment

This directory documents end-to-end Shibboleth Link deployment. Follow the shared setup steps first, choose one deployment target, then complete post-deploy setup and smoke tests.

## Table Of Contents

1. Discord application setup
   - Create a Discord application and bot.
   - Record the bot token, client ID, client secret, and public key.
   - Configure OAuth redirect URL: `https://<hostname>/api/discord/callback`.
   - Configure Interactions Endpoint URL: `https://<hostname>/api/discord/interactions/callback`.
   - Generate a bot invite with `bot` and `applications.commands` scopes.

2. Shibboleth service provider setup
   - Choose the SAML issuer/entity ID.
   - Configure ACS callback URL: `https://<hostname>/api/saml/callback`.
   - Provide the IdP certificate and SP private key.
   - Ensure UIUC releases NetID and affiliation attributes.

3. Client configuration
   - Edit `client/src/lib/site.ts`.
   - Configure public links such as operator URL, contact email, source URL, Discord/community invite URL, and bot invite URL.
   - Build the Astro client with `npm run build` in `client/`.

4. Environment configuration
   - Copy `.env.example` to `.env` at the repository root.
   - Fill in Discord, SAML, operator, and deployment values.
   - Keep `.env` and SAML key material out of git.

5. Choose a deployment target
    - [05a Cloudflare Workers](05a-cloudflare-workers.md)
    - [05b Self-hosted](05b-self-hosted.md)
    - If upgrading from the legacy 2.0 SQLite schema, read [06 Legacy 2.0 Migration Notes](06-legacy-2-migration.md) before starting the 3.0 server against the old database.

6. Discord command registration
    - Run `npm run discord:commands:register` from `server/`.
    - Normal server commands are registered globally.
    - Operator commands are registered only in `OPERATOR_GUILD_ID`.
    - Global commands can take time to appear and may require restarting the Discord client.

7. Cloudflare runtime binding setup, for Workers deployments
   - Run `npm run worker:secrets:set` from `server/` once after filling in `.env`.
   - Re-run it only when Discord, SAML, JWT, or operator runtime values change.
   - Regular Worker deploys do not resend runtime bindings.

8. First server setup
    - Invite the bot to the Discord server.
    - Run `/config`.
    - Set role mappings.
    - Set admin channel.
    - Enable admin-channel logging if desired.
    - Run `/test`.
    - Run `/link` and complete a browser link flow.
    - Run `/verify-self` and `/verify` if the server needs Verified Server status.
    - In Verified Servers, `/lookup` can be used outside the admin channel with ephemeral responses; `/export` and `/delete-links` are admin-channel-only.

9. Smoke tests
   - Check `GET /api/health`.
   - Open `/` and `/link?server=<guild-id>`.
   - Complete SAML and Discord OAuth callbacks.
   - Confirm role grants.
   - If Link and Store is enabled, test `/lookup`, `Lookup NetID`, `/export`, and `/delete-links`.

10. Troubleshooting
   - Commands missing: wait for global command propagation or restart Discord.
   - SAML failures: check issuer, ACS URL, IdP certificate, SP key, and released attributes.
   - Role grant failures: check Manage Roles and role hierarchy.
   - Export/logging failures: check View Channel, Send Messages, and Attach Files in the admin channel.
   - Cloudflare challenges: do not challenge callback routes.
