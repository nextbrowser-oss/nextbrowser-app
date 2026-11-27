import { translate } from "../shared/lib/i18n";
import { useState } from "react";
import { Monitor, Network } from "lucide-react";
import { GithubMark } from "./CommunityControls";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { Button } from "../shared/ui";
import { AgentImport } from "./AgentImport";
import { PersonalProfiles } from "./PersonalProfiles";

type GitHubResult = { status: "connected"; login: string } | { status: "missing" | "unavailable" };

function LocalGitHub({ owner }: { owner: string }) {
  const key = "nextbrowser.personal.github." + owner;
  const [login, setLogin] = useState(() => localStorage.getItem(key) || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function connect() {
    setBusy(true);
    setNotice("");
    try {
      const result = await invoke<GitHubResult>("account_github_profile");
      if (result.status === "connected") {
        localStorage.setItem(key, result.login);
        setLogin(result.login);
      } else if (result.status === "missing") setNotice(translate("Install GitHub CLI, run gh auth login, then choose Connect."));
      else setNotice(translate("Check your connection and sign in with gh auth login, then choose Connect."));
    } catch { setNotice(translate("Could not connect the GitHub CLI account. Try again.")); }
    finally { setBusy(false); }
  }
  return <div className="account-network-section">
    <div className="account-network-row"><GithubMark size={16} /><div><strong>GitHub</strong>
      <small>{login ? "@" + login + " · Linked on this device" : translate("Link your active GitHub CLI account on this device")}</small></div>
      <Button disabled={busy} onClick={() => {
        if (!login) { void connect(); return; }
        try { localStorage.removeItem(key); setLogin(""); setNotice(""); }
        catch { setNotice(translate("Could not remove the local link.")); }
      }}>{login ? translate("Unlink") : busy ? translate("Connecting…") : translate("Connect")}</Button>
    </div>
    {notice && <p role="status">{notice} <button className="link" onClick={() => void invoke("open_external", { url: "https://cli.github.com/" }).catch(() => setNotice(translate("Open cli.github.com to set up GitHub CLI.")))}>{translate("GitHub CLI ↗")}</button></p>}
  </div>;
}

export function AccountNetworkData({ owner, onDevices }: { owner: string; onDevices: () => void }) {
  return <section className="account-network-data claw-card" aria-label={translate("Control my network data")}>
    <h2>{translate("Control my network data")}</h2>
    <p className="account-network-note">{translate("Your imported browser profiles and agent data stay on this device. Nextbrowser does not store these imports on its servers.")}</p>
    <PersonalProfiles owner={owner} />
    <AgentImport owner={owner} />
    <LocalGitHub key={owner} owner={owner} />
    <div className="account-network-row"><Network size={16} /><strong>Multilogin</strong>
      <Button onClick={() => useStore.getState().openConnectorPrompt("multilogin")}>{translate("Manage connection")}</Button></div>
    <div className="account-network-row"><Monitor size={16}/><strong>{translate("Signed-in devices")}</strong><Button onClick={onDevices}>{translate("View devices")}</Button></div>
  </section>;
}
