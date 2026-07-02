# 06 Legacy 2.0 Migration Notes

This note applies when a self-hosted Shibboleth Link 3.0 server starts against a SQLite database that still contains the legacy 2.0 tables.

The migration in `server/migrations/0001_migrate_from_2.sql` preserves existing 2.0 behavior, but that preservation has privacy-visible effects that operators should review before upgrading.

## What Is Imported

- Legacy Discord server rows become 3.0 guild configuration rows.
- Legacy affiliation-to-role mappings become 3.0 role mappings.
- Legacy user link rows become 3.0 stored links containing Discord server ID, Discord user ID, UIUC NetID, UIUC affiliations, and migration timestamps.

## Privacy-Relevant Defaults

- Any server with legacy user rows is migrated to `link_and_store` mode.
- Any server with legacy user rows has admin-channel link logging enabled if the legacy server had a logging channel configured.
- Imported stored links are not automatically deleted when a server later switches back to Confirm Only.
- Imported stored links are not visible through lookup/export until the server becomes a Verified Server, but once verified, historical imported links may become queryable or exportable.
- Audit, moderation, verifier, guild configuration, and role mapping records are persistent operational records and are not removed by transient cleanup.

## Before Upgrading

- Back up the legacy database.
- Tell server operators that historical user links will be imported as stored links.
- Decide whether each server should continue in Link and Store mode or switch to Confirm Only after migration.
- Decide whether imported stored links should be retained or deleted with `/delete-links` after migration.
- Confirm that privacy-policy and server-facing consent copy match the intended post-upgrade behavior.

## After Upgrading

- Run `/config` in each server and review privacy mode, admin channel, logging, and role mappings.
- Run `/delete-links` for any server that should not retain imported historical links.
- Run `/test` after reviewing configuration.
- If a server needs lookup/export, complete Verified Server setup with `/verify-self` and `/verify`.
