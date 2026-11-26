import { formattingLocale, translate } from "../shared/lib/i18n";
import { useEffect, useState } from "react";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { Glyph, IconButton } from "../shared/ui";

interface Session {
  id: string;
  name: string;
  platform: string;
  last_seen_at: string;
  paired_only: boolean;
}
interface Devices { current: string; sessions: Session[] }
const platforms: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function DeviceSessions() {
  const account = useStore(s => s.authed && (s.accountOwnerId || s.accountEmail || "signed-in"));
  return account ? <DeviceList key={account} /> : <p className="muted small">{translate("Sign in to view your devices.")}</p>;
}

function DeviceList() {
  const [data, setData] = useState<Devices>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    invoke<Devices>("device_sessions_list").then(result => {
      if (!Array.isArray(result?.sessions)) throw new Error("Could not load device sessions.");
      if (active) setData(result);
    }).catch(cause => {
      if (active) setError(String(cause?.message || "Could not load device sessions.").replace(/^.*?Error: /, ""));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  return <div className="settings-group">
    <div className="settings-row">
      <strong>{translate("Signed-in devices")}</strong>
      <IconButton label={translate("Refresh device sessions")} appearance="plain" size="small" disabled={loading} onClick={() => setRefresh(n => n + 1)}>
        <Glyph name="refresh" size={15} />
      </IconButton>
    </div>
    {error && <p role="alert" className="muted small">{error}</p>}
    {loading && !data && <p role="status" className="muted small">{translate("Loading devices…")}</p>}
    {data && [false, true].map(paired => {
      const items = data.sessions.filter(s => s.paired_only === paired);
      if (!items.length) return paired ? null : <p key="empty" className="muted small">{translate("No devices have reported a session yet.")}</p>;
      return <div key={String(paired)}>
        {paired && <h3 className="small">{translate("Earlier pairings")}</h3>}
        {items.map(s => <div className="settings-row" key={s.id}>
          <span><Glyph name="monitor" size={15} /> <strong>{s.name}</strong>{s.id === data.current && !paired && translate(" · This device")}
            <small className="muted"> {platforms[s.platform] || s.platform}</small></span>
          <small className="muted">{paired ? translate("Paired") : translate("Last seen")} <time dateTime={s.last_seen_at}>{new Date(s.last_seen_at).toLocaleString(formattingLocale())}</time></small>
        </div>)}
      </div>;
    })}
  </div>;
}
