export const siteConfig = {
  operatorName: 'SIGPwny',
  operatorUrl: 'https://sigpwny.com/',
  privacyPolicyUrl: '/privacy',
  termsUrl: '/terms',
  contactUrl: '/contact',
  contactEmail: 'shibboleth@sigpwny.com',
  discordInviteUrl: 'https://discord.gg/cWcZ6a9',
  botInviteUrl: 'https://discord.com/oauth2/authorize?client_id=621748555819778068&permissions=268471296&integration_type=0&scope=applications.commands+bot',
  sourceUrl: 'https://github.com/sigpwny/shibboleth-link',
} as const;

export const mailtoContactUrl = `mailto:${siteConfig.contactEmail}`;
