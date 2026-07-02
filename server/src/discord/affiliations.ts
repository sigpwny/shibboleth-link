export const AFFILIATIONS = [
  { value: 'member', label: 'Member', emoji: '✅' },
  { value: 'student', label: 'Student', emoji: '🎓' },
  { value: 'alum', label: 'Alum', emoji: '🧡' },
  { value: 'staff', label: 'Staff', emoji: '🏛️' },
] as const;

export type AffiliationValue = typeof AFFILIATIONS[number]['value'];

const byValue = new Map(AFFILIATIONS.map((affiliation) => [affiliation.value, affiliation]));

export function normalizeAffiliation(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return byValue.has(normalized as AffiliationValue) ? normalized : null;
}

export function encodeAffiliations(values: string[]): string {
  return [...new Set(values.map((value) => normalizeAffiliation(value)).filter((value): value is string => Boolean(value)))]
    .sort()
    .join(',');
}

export function affiliationMask(values: string[]): number {
  const normalized = new Set(values.map((value) => normalizeAffiliation(value)).filter((value): value is string => Boolean(value)));
  return AFFILIATIONS.reduce((mask, affiliation, index) => normalized.has(affiliation.value) ? mask | (1 << index) : mask, 0);
}

export function affiliationsFromMask(mask: number): string[] {
  return AFFILIATIONS.filter((_, index) => (mask & (1 << index)) !== 0).map((affiliation) => affiliation.value);
}

export function decodeAffiliations(value: string): string[] {
  return value.split(',').map((part) => normalizeAffiliation(part)).filter((part): part is string => Boolean(part));
}

export function prettyAffiliation(value: string): string {
  const affiliation = byValue.get(value as AffiliationValue);
  return affiliation ? affiliation.label : value;
}

export function prettyAffiliations(value: string): string {
  const affiliations = decodeAffiliations(value);
  return affiliations.length > 0 ? affiliations.map(prettyAffiliation).join(', ') : value;
}

export function affiliationChoices() {
  return AFFILIATIONS.map((affiliation) => ({
    name: affiliation.label,
    value: affiliation.value,
  }));
}

export function affiliationSelectOptions() {
  return AFFILIATIONS.map((affiliation) => ({
    label: affiliation.label,
    value: affiliation.value,
  }));
}
