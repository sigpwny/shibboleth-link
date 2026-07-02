export interface SamlAttributeDefinition {
  key: 'uid' | 'eduPersonAffiliation';
  oid: string;
  name: string;
  friendlyName: string;
  description: string;
  required: boolean;
  valueKind: 'string' | 'string[]';
}

export const SAML_ATTRIBUTES = {
  uid: {
    key: 'uid',
    oid: 'urn:oid:0.9.2342.19200300.100.1.1',
    name: 'uid',
    friendlyName: 'NetID',
    description: 'Your UIUC NetID. In Confirm Only linking, it is used for the current role check and then cleared. In Link and Store or server verification flows, it may be retained as described in the privacy policy.',
    required: false,
    valueKind: 'string',
  },
  eduPersonAffiliation: {
    key: 'eduPersonAffiliation',
    oid: 'urn:oid:1.3.6.1.4.1.5923.1.1.1.1',
    name: 'eduPersonAffiliation',
    friendlyName: 'Affiliation',
    description: 'Affiliation values such as student, staff, member, employee, or affiliate.',
    required: false,
    valueKind: 'string[]',
  },
} satisfies Record<string, SamlAttributeDefinition>;

export const SAML_ATTRIBUTE_LIST = Object.values(SAML_ATTRIBUTES);
