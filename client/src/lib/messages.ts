const errorCodes: Record<string, string> = {
  flow_not_ready: 'WEB_LINK_FLOW_NOT_READY',
  user_not_in_guild: 'WEB_USER_NOT_IN_SERVER',
  role_hierarchy: 'WEB_ROLE_HIERARCHY',
  missing_manage_roles: 'WEB_MISSING_MANAGE_ROLES',
  role_not_found: 'WEB_ROLE_NOT_FOUND',
  role_managed: 'WEB_ROLE_MANAGED',
  discord_api_error: 'WEB_DISCORD_ROLE_UPDATE_FAILED',
  saml_validation_failed: 'WEB_SAML_VALIDATION_FAILED',
  missing_netid: 'WEB_MISSING_NETID',
  expired_flow: 'WEB_LINK_SESSION_EXPIRED',
  linking_disabled: 'WEB_LINKING_DISABLED',
  server_banned: 'WEB_SERVER_BANNED',
  user_banned: 'WEB_DISCORD_USER_BANNED',
  netid_banned: 'WEB_NETID_BANNED',
  verification_permission_lost: 'WEB_VERIFY_PERMISSION_LOST',
};

export function codeFor(error: string | null): string {
  return error ? errorCodes[error] ?? 'WEB_UNKNOWN_ERROR' : '';
}

export function messageFor(error: string | null): string {
  switch (error) {
    case 'flow_not_ready':
      return 'Please finish adding your accounts, then try linking again.';
    case 'user_not_in_guild':
      return 'You must join the Discord server before linking.';
    case 'role_hierarchy':
      return 'Please report this error to the Discord server owner: The bot role is not high enough to grant the configured role.';
    case 'missing_manage_roles':
      return 'Please report this error to the Discord server owner: The bot is missing Manage Roles permission.';
    case 'role_not_found':
      return 'Please report this error to the Discord server owner: The configured Discord role no longer exists.';
    case 'role_managed':
      return 'Please report this error to the Discord server owner: The configured Discord role is managed by an integration.';
    case 'discord_api_error':
      return 'Please report this error to the Discord server owner: Discord rejected the role update. Check bot permissions and role order.';
    case 'saml_validation_failed':
      return 'Please report this error to the Shibboleth Link operator: UIUC sign-in could not be validated.';
    case 'missing_netid':
      return 'Please report this error to the Shibboleth Link operator: UIUC did not send a NetID for this login.';
    case 'expired_flow':
      return 'This linking session expired, please try again.';
    case 'linking_disabled':
      return 'Linking is currently disabled for this server.';
    case 'server_banned':
      return 'This Discord server has been banned from Shibboleth Link.';
    case 'user_banned':
      return 'This Discord account has been banned from Shibboleth Link.';
    case 'netid_banned':
      return 'This UIUC NetID has been banned from Shibboleth Link.';
    case 'verification_permission_lost':
      return 'You are no longer a server owner or administrator for this Discord server, so this verification flow cannot be completed.';
    default:
      return error ? 'Something went wrong. Try again.' : '';
  }
}

export function errorDetails(error: string | null): { message: string; code: string } {
  return { message: messageFor(error), code: codeFor(error) };
}
