import type { ServerVerifier } from '../storage/types.js';

export function verificationExpiry(now = new Date()): number {
  const year = now.getUTCFullYear();
  const augustThisYear = Date.UTC(year, 7, 1);
  const renewalStart = augustThisYear - 30 * 24 * 60 * 60 * 1000;
  const expiryYear = now.getTime() >= renewalStart ? year + 1 : year;
  return Date.UTC(expiryYear, 7, 1);
}

export function isActiveUiucMember(affiliations: string[]): boolean {
  const values = new Set(affiliations.map((value) => value.toLowerCase()));
  return (values.has('student') && !values.has('alum')) || values.has('staff');
}

export function isAlum(affiliations: string[]): boolean {
  return affiliations.map((value) => value.toLowerCase()).includes('alum');
}

export function verificationSatisfied(verifiers: ServerVerifier[]): boolean {
  return verifiers.some((verifier) => verifier.active && (verifier.isAdmin || verifier.isOwner));
}
