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

const ISO_COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const englishRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const ROTATION_COUNTRIES: RotationCountry[] = ISO_COUNTRY_CODES
  .map((code) => ({ code, name: englishRegionNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

function normalizedSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en");
}

export function filterCountryList(countries: RotationCountry[], query: string): RotationCountry[] {
  const normalizedQuery = normalizedSearchValue(query.trim());
  if (!normalizedQuery) return countries;
  return countries.filter(({ code, name }) =>
    normalizedSearchValue(`${name} ${code}`).includes(normalizedQuery),
  );
}

export function filterCountries(query: string): RotationCountry[] {
  return filterCountryList(ROTATION_COUNTRIES, query);
}
