// ISO 3166-1 alpha-2 → flag emoji (mirrors CountryFlag.swift).

const REGIONAL = 0x1f1e6;
const A = "A".charCodeAt(0);

export function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "";
  const u = code.toUpperCase();
  const a = u.charCodeAt(0) - A;
  const b = u.charCodeAt(1) - A;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "";
  return String.fromCodePoint(REGIONAL + a, REGIONAL + b);
}

export function countryLabel(code?: string | null, city?: string | null): string {
  const flag = countryFlag(code);
  return [flag, code?.toUpperCase(), city]
    .filter((part): part is string => !!part && part.length > 0)
    .join(" ");
}

export interface RotationCountry {
  code: string;
  name: string;
}

// Common country hints for proxy/country rotation (ISO 3166-1 alpha-2), sorted
// alphabetically by name for the rotation menus — mirrors Models.swift
// `RotationCountries.list`.
export const ROTATION_COUNTRIES: RotationCountry[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "CA", name: "Canada" },
  { code: "EE", name: "Estonia" },
  { code: "RU", name: "Russia" },
  { code: "UA", name: "Ukraine" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
  { code: "JP", name: "Japan" },
  { code: "AU", name: "Australia" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "UAE" },
].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
