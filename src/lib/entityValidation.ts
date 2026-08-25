export const entityNameLimits = {
  workspace: 200,
  project: 200,
  profile: 120,
} as const;

export function validateEntityName(kind: keyof typeof entityNameLimits, rawValue: string): string {
  const value = rawValue.trim();
  const label = kind[0].toUpperCase() + kind.slice(1);
  if (!value) throw new Error(`${label} name is required.`);
  const maximum = entityNameLimits[kind];
  if ([...value].length > maximum) {
    throw new Error(`${label} name is too long (maximum ${maximum} characters).`);
  }
  return value;
}
