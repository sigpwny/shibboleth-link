export const siteConfig = {
  operatorName: 'SIGPwny',
  operatorUrl: 'https://sigpwny.com/',
  privacyPolicyUrl: '/privacy',
  termsUrl: '/terms',
  contactUrl: '/contact',
  contactEmail: 'shibboleth@sigpwny.com',
  discordInviteUrl: 'https://discord.gg/cWcZ6a9',
  botInviteUrl: 'https://sigpwny.com/',
  sourceUrl: 'https://github.com/sigpwny/shibboleth-link',
} as const;

export const mailtoContactUrl = `mailto:${siteConfig.contactEmail}`;
