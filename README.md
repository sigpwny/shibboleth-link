# Shibboleth Link

Shibboleth Link connects UIUC Shibboleth authentication to Discord role assignment. It lets Discord servers grant configured roles based on UIUC affiliation while supporting two privacy modes: short-lived Confirm Only linking and server-scoped Link and Store records.

## Architecture

- Static Astro/Svelte frontend.
- Runtime-neutral Hono API.
- Cloudflare Workers + Workers Static Assets + D1 deployment.
- Self-hosted Node + SQLite deployment.
- Direct Discord role assignment through a Discord bot token.
- Discord HTTP interactions for slash commands and context menu commands. No gateway bot process is required.
- Native SAML flow using `@node-saml/node-saml`.

Deployment guides:

- [Deployment overview](docs/deployment/README.md)
- [Cloudflare Workers](docs/deployment/05a-cloudflare-workers.md)
- [Self-hosted](docs/deployment/05b-self-hosted.md)

## Privacy Modes

### Confirm Only

Confirm Only grants Discord roles without storing a permanent UIUC-to-Discord account link.

- UIUC and Discord identity are kept in short-lived encrypted HttpOnly cookies before confirmation.
- After confirmation, identity cookies are cleared.
- Completed flow rows do not keep NetID, affiliations, Discord user ID, or Discord username.
- If admin-channel logging is enabled, server owners may see Discord user ID, UIUC affiliation, granted roles, and role-grant errors.
- NetID is not shared with Discord server owners in Confirm Only mode.

### Link and Store

Link and Store stores server-scoped account links in the Shibboleth Link database.

Stored links include:

- Discord server ID.
- Discord user ID.
- UIUC NetID.
- UIUC affiliations.
- Created and updated timestamps.

Unverified servers can enable Link and Store and store links. Features that reveal NetIDs, such as lookup and export, require Verified Server status. If a server becomes verified later, older stored links may become queryable/exportable.

Switching from Link and Store back to Confirm Only does not delete existing stored links. Server admins can use `/delete-links` to delete all stored links for that server. Audit and moderation records are retained.

## Verified Servers

A Verified Server has current verification showing that eligible UIUC-affiliated people have administrative control of the Discord server.

Policy-issued verification uses this rule:

- Active UIUC member means `student OR staff`.
- One server owner or administrator must verify as an active UIUC member.

Policy-issued verification expires annually on August 1. Renewals in the 30-day window before August 1 expire the following August 1. Operators can also manually issue verification with an arbitrary expiration.

## Discord Commands

Normal server commands are registered globally:

- `/link`
  - Returns the server-specific Shibboleth Link URL.

- `/config`
  - Opens the interactive server configuration panel.
  - Configures allow linking, privacy mode, admin channel, admin-channel logging, and role mappings.

- `/test`
  - Checks bot role assignment permissions and admin-channel logging/export permissions.

- `/verify`
  - Shows current Verified Server status and verification progress.

- `/verify-self`
  - Starts a personal browser flow for a server owner/admin verifier.

- `/lookup netid netid:<netid>`
  - Looks up Discord accounts associated with a stored NetID.
  - Requires Verified Server status.
  - Can be run outside the configured admin channel; outside that channel, the response is ephemeral to the command user.

- `/lookup discord user:<user>`
  - Looks up stored NetIDs associated with a Discord user.
  - Requires Verified Server status.
  - Can be run outside the configured admin channel; outside that channel, the response is ephemeral to the command user.

- `Lookup NetID` user context command
  - Right-click a user and look up stored NetIDs for that Discord user.
  - Always ephemeral.
  - Requires Verified Server status.

- `Lookup NetID` message context command
  - Right-click a message and look up stored NetIDs for the message author.
  - Always ephemeral.
  - Requires Verified Server status.

- `/export`
  - Exports stored links as CSV attachment.
  - Only works in the configured admin channel.
  - Requires Verified Server status.

- `/delete-links`
  - Deletes all stored links for the server.
  - Only works in the configured admin channel.
  - Requires a red-button confirmation and modal text confirmation.
  - Keeps audit and moderation records.

Operator commands are registered only in the configured operator guild/channel:

- `/operator stats`
- `/operator verify server:<id> expires:<time>`
- `/operator unverify server:<id>`
- `/operator ban target:<user|server|netid> id:<string> expires:<time?>`
- `/operator unban target:<user|server|netid> id:<string>`

## Security Notes

- Browser identity state is stored in encrypted HttpOnly cookies with a short TTL.
- OAuth/SAML state and SAML request replay records are stored server-side.
- Discord interactions are verified with Discord request signatures.
- `/link` is intentionally available to all server members. Other normal commands use Discord command permissions and are unavailable by default except to administrators.
- Operator commands are runtime-restricted to the configured operator guild and channel.
- User/server/NetID bans are enforced across bot commands and browser linking/verification flows.

## Repository Layout

- `client/`: Astro/Svelte static frontend.
- `server/`: Hono API, Worker entrypoint, Node entrypoint, Discord interactions, SAML/OAuth routes, storage adapters, migrations.
- `docs/`: deployment guides.

## Roadmap / Wishlist

Potential future work:

- NetID allowlists and denylists for server-specific access control.
- Discord server moderation actions based on denylisted NetIDs.
- FERPA-compliant roster support for class Discord servers.
- Web-based server management for configuration, role mappings, lookup/export workflows, and verification state.
