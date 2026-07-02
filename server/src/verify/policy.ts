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
  const owner = verifiers.find((verifier) => verifier.isOwner);
  if (owner?.active) {
    return true;
  }

  const activeAdmins = verifiers.filter((verifier) => verifier.isAdmin && verifier.active && !verifier.isOwner);
  if (owner?.alum && activeAdmins.length >= 1) {
    return true;
  }

  return verifiers.filter((verifier) => verifier.isAdmin && verifier.active).length >= 2;
}
