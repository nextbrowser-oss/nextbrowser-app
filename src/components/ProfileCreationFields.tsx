import { Select } from "../shared/ui";
import { countryFlag, filterCountryList, type RotationCountry } from "../lib/countryFlag";
import { Icon } from "./Icon";
import type { PersonalProxyOption } from "./PersonalProxySelect";
import "./profileCreation.css";

export const toolsetOptions = [
  { value: "clawbrowser", label: "Clawbrowser", description: "Managed identity and proxy", decoration: <Icon name="globe" size={16} /> },
  { value: "dasbrowser", label: "DasBrowser", description: "Private multi-account browser", decoration: <Icon name="safari" size={16} /> },
  { value: "camoufox", label: "Camoufox", description: "Firefox anti-detect browser", decoration: <Icon name="shield" size={16} /> },
  { value: "multilogin", label: "Multilogin", description: "Mimic profiles from your Multilogin account", decoration: <img src="./multilogin-icon.svg" alt="" width="16" height="16" /> },
] as const;

export const connectionOptions = [
  { value: "direct", label: "No proxy", description: "Use your direct internet connection", decoration: <Icon name="network" size={16} /> },
  { value: "managed", label: "Managed proxy", description: "Choose the proxy country", decoration: <Icon name="globe" size={16} /> },
  { value: "personal", label: "Personal proxy", description: "Use one of your saved proxies", decoration: <Icon name="network" size={16} /> },
] as const;

function countryOption({ code, name }: RotationCountry) {
  return { value: code, label: `${name} · ${code}`, decoration: countryFlag(code) };
}

export function ProfileCountrySelect({ countries, value, disabled, onChange }: {
  countries: RotationCountry[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  return <Select overlay label="Proxy country" value={value.toUpperCase()} disabled={disabled} onChange={onChange}
    options={countries.map(countryOption)} searchPlaceholder="Search countries…"
    filterOptions={query => filterCountryList(countries, query).map(countryOption)} />;
}

export function ProfileProxySelect({ proxies, value, disabled, label, onChange, onAdd }: {
  proxies: PersonalProxyOption[]; value: string; disabled: boolean; label: string; onChange: (value: string) => void; onAdd: () => void;
}) {
  return <>
    <Select overlay label={label} value={value} disabled={disabled} onChange={onChange}
      options={proxies.map(proxy => ({ value: proxy.id, label: proxy.name, description: `${proxy.scheme.toUpperCase()} · ${proxy.host}:${proxy.port}` }))} />
    <button className="link profile-add-proxy" type="button" disabled={disabled} onClick={onAdd}><Icon name="plus" size={13} /> Add proxy</button>
  </>;
}
