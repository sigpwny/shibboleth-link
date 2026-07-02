-- Consolidated Shibboleth Link 3.0 schema.
--
-- This migration can run on an empty database or on a Shibboleth Link 2.0
-- SQLite database. When 2.0 tables are present, it imports their server,
-- role mapping, and stored user-link data into the 3.0 schema.

CREATE TABLE IF NOT EXISTS link_flows (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  step TEXT NOT NULL,
  shib_uid TEXT,
  shib_affiliations TEXT,
  discord_user_id TEXT,
  discord_username TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_link_flows_guild_id ON link_flows (guild_id);
CREATE INDEX IF NOT EXISTS idx_link_flows_expires_at ON link_flows (expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  PRIMARY KEY (state_hash, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_flow_id ON oauth_states (flow_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_url TEXT,
  admin_channel_id TEXT,
  log_links_enabled INTEGER NOT NULL DEFAULT 0,
  linking_enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'confirm_only',
  verified INTEGER NOT NULL DEFAULT 0,
  verification_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_mappings (
  guild_id TEXT NOT NULL,
  affiliation TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, affiliation)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  flow_id TEXT,
  guild_id TEXT,
  type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_guild_id ON audit_events (guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at);

CREATE TABLE IF NOT EXISTS saml_requests (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_saml_requests_expires_at ON saml_requests (expires_at);

CREATE TABLE IF NOT EXISTS server_verification_flows (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  requester_discord_user_id TEXT NOT NULL,
  requester_is_owner INTEGER NOT NULL,
  requester_is_admin INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_server_verification_flows_guild_id ON server_verification_flows (guild_id);
CREATE INDEX IF NOT EXISTS idx_server_verification_flows_expires_at ON server_verification_flows (expires_at);

CREATE TABLE IF NOT EXISTS server_verifiers (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  shib_uid TEXT NOT NULL,
  affiliations TEXT NOT NULL,
  is_owner INTEGER NOT NULL,
  is_admin INTEGER NOT NULL,
  active INTEGER NOT NULL,
  alum INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_verifiers_guild_id ON server_verifiers (guild_id);
CREATE INDEX IF NOT EXISTS idx_server_verifiers_expires_at ON server_verifiers (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_server_verifiers_guild_shib_uid ON server_verifiers (guild_id, shib_uid);

CREATE TABLE IF NOT EXISTS stored_links (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  shib_uid TEXT NOT NULL,
  shib_affiliations TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_stored_links_guild_id ON stored_links (guild_id);
CREATE INDEX IF NOT EXISTS idx_stored_links_guild_shib_uid ON stored_links (guild_id, shib_uid);

CREATE TABLE IF NOT EXISTS bans (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  banned_by_discord_user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_bans_expires_at ON bans (expires_at);

-- 2.0 compatibility tables. These are created only when absent so the import
-- statements below can run on a fresh 3.0 database without referencing missing
-- tables. They are dropped after import.
CREATE TABLE IF NOT EXISTS "DiscordServer" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'temp name',
  description TEXT NOT NULL DEFAULT 'temp description',
  allowlistEnabled INTEGER NOT NULL DEFAULT 0,
  authRole TEXT,
  loggingChannelId TEXT
);

CREATE TABLE IF NOT EXISTS "User" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shibId TEXT NOT NULL,
  discordId TEXT NOT NULL,
  shibAffiliations TEXT NOT NULL,
  discordServerId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "AffiliationToRoleMapping" (
  shibAffiliation TEXT NOT NULL,
  discordRole TEXT NOT NULL,
  discordServerId TEXT NOT NULL,
  PRIMARY KEY (shibAffiliation, discordServerId)
);

-- Import 2.0 Discord servers. Servers with existing users are migrated to
-- Link and Store mode and have admin-channel logging enabled.
INSERT OR IGNORE INTO guild_configs (
  guild_id,
  name,
  icon_url,
  admin_channel_id,
  log_links_enabled,
  linking_enabled,
  mode,
  verified,
  verification_expires_at,
  created_at,
  updated_at
)
SELECT
  ds.id,
  ds.name,
  NULL,
  ds.loggingChannelId,
  CASE WHEN EXISTS (SELECT 1 FROM "User" u WHERE u.discordServerId = ds.id) THEN 1 ELSE 0 END,
  1,
  CASE WHEN EXISTS (SELECT 1 FROM "User" u WHERE u.discordServerId = ds.id) THEN 'link_and_store' ELSE 'confirm_only' END,
  0,
  NULL,
  mt.now_ms,
  mt.now_ms
FROM "DiscordServer" ds
CROSS JOIN (SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms) mt;

-- Preserve user links even if a referenced server row is missing in 2.0.
INSERT OR IGNORE INTO guild_configs (
  guild_id,
  name,
  icon_url,
  admin_channel_id,
  log_links_enabled,
  linking_enabled,
  mode,
  verified,
  verification_expires_at,
  created_at,
  updated_at
)
SELECT DISTINCT
  u.discordServerId,
  'Discord server ' || u.discordServerId,
  NULL,
  NULL,
  1,
  1,
  'link_and_store',
  0,
  NULL,
  mt.now_ms,
  mt.now_ms
FROM "User" u
CROSS JOIN (SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms) mt;

-- Preserve role mappings even if a referenced server row is missing in 2.0.
INSERT OR IGNORE INTO guild_configs (
  guild_id,
  name,
  icon_url,
  admin_channel_id,
  log_links_enabled,
  linking_enabled,
  mode,
  verified,
  verification_expires_at,
  created_at,
  updated_at
)
SELECT DISTINCT
  rm.discordServerId,
  'Discord server ' || rm.discordServerId,
  NULL,
  NULL,
  0,
  1,
  'confirm_only',
  0,
  NULL,
  mt.now_ms,
  mt.now_ms
FROM "AffiliationToRoleMapping" rm
CROSS JOIN (SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms) mt;

-- Import explicit 2.0 affiliation-to-role mappings.
INSERT OR IGNORE INTO role_mappings (guild_id, affiliation, role_id)
SELECT
  discordServerId,
  shibAffiliation,
  discordRole
FROM "AffiliationToRoleMapping";

-- Import 2.0 authRole as the member role mapping, unless an explicit member
-- mapping already exists.
INSERT OR IGNORE INTO role_mappings (guild_id, affiliation, role_id)
SELECT
  id,
  'member',
  authRole
FROM "DiscordServer"
WHERE authRole IS NOT NULL AND authRole != '';

-- Import 2.0 users as stored links. If multiple 2.0 rows exist for the same
-- server/Discord user, keep the row with the lowest 2.0 User.id.
INSERT OR IGNORE INTO stored_links (
  guild_id,
  discord_user_id,
  shib_uid,
  shib_affiliations,
  created_at,
  updated_at
)
WITH first_links AS (
  SELECT discordServerId, discordId, MIN(id) AS id
  FROM "User"
  GROUP BY discordServerId, discordId
), migration_time AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
)
SELECT
  u.discordServerId,
  u.discordId,
  u.shibId,
  CASE
    WHEN u.shibAffiliations IS NULL OR u.shibAffiliations = '' THEN '[]'
    ELSE '["' || replace(u.shibAffiliations, ';', '","') || '"]'
  END,
  migration_time.now_ms,
  migration_time.now_ms
FROM first_links
JOIN "User" u ON u.id = first_links.id
CROSS JOIN migration_time;

DROP TABLE IF EXISTS "AffiliationToRoleMapping";
DROP TABLE IF EXISTS "User";
DROP TABLE IF EXISTS "DiscordServer";
