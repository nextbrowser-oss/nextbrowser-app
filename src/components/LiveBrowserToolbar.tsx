import { translate } from "../shared/lib/i18n";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from "lucide-react";
import { IconButton, Tooltip } from "../shared/ui";
import type { LiveBrowserAction, RemoteLiveTab } from "../remoteControl";

export function LiveBrowserToolbar({ tabs, currentURL, canNavigate, busy, onSelect, onAction }: {
  tabs: RemoteLiveTab[];
  currentURL: string;
  canNavigate: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onAction: (action: LiveBrowserAction, targetID?: string, url?: string) => boolean;
}) {
  const activeTab = tabs.find(tab => tab.active);
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const pageURL = activeTab?.url || currentURL;
  const address = pageURL === "about:blank" ? "" : pageURL;
  const canUseActiveTab = canNavigate && !busy && !!activeTab;

  function navigate(event: FormEvent) {
    event.preventDefault();
    if (!canUseActiveTab) return;
    const value = (draft ?? address).trim();
    if (!value) return;
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch {
      setInvalid(true);
      return;
    }
    if (onAction("navigate", activeTab.target_id, url.href)) setDraft(undefined);
  }

  return <div className="live-browser-toolbar">
    <div className="live-browser-tab-row">
      <div className="live-browser-tabs shared-scrollbarless" role="group" aria-label={translate("Browser tabs")}>
        {tabs.map(tab => {
          const title = tab.title || (tab.url === "about:blank" ? "New tab" : tab.url) || "New tab";
          return <div className="live-browser-tab" data-active={tab.active || undefined} key={tab.target_id}>
            <Tooltip content={title}>
              <button type="button" aria-pressed={!!tab.active} disabled={busy}
                onClick={() => { setDraft(undefined); setInvalid(false); onSelect(tab.target_id); }}>
                {title}
              </button>
            </Tooltip>
            {canNavigate && tabs.length > 1 && tab.can_close && <IconButton label={translate("Close %1", title)} size="small" appearance="plain"
              disabled={busy} onClick={() => onAction("close", tab.target_id)}><X size={14} /></IconButton>}
          </div>;
        })}
      </div>
      {canNavigate && <IconButton label={translate("New tab")} appearance="plain" size="small" disabled={busy} onClick={() => onAction("new")}>
        <Plus size={17} />
      </IconButton>}
    </div>
    <form className="live-browser-address" onSubmit={navigate}>
      <IconButton label={translate("Back")} appearance="plain" size="small" disabled={!canUseActiveTab} onClick={() => onAction("back", activeTab?.target_id)}>
        <ArrowLeft size={17} />
      </IconButton>
      <IconButton label={translate("Forward")} appearance="plain" size="small" disabled={!canUseActiveTab} onClick={() => onAction("forward", activeTab?.target_id)}>
        <ArrowRight size={17} />
      </IconButton>
      <IconButton label={translate("Reload")} appearance="plain" size="small" disabled={!canUseActiveTab} onClick={() => onAction("reload", activeTab?.target_id)}>
        <RotateCw size={16} />
      </IconButton>
      <input type="text" aria-label={translate("Browser address")} aria-invalid={invalid || undefined} autoComplete="off" spellCheck={false}
        placeholder={translate("Enter a web address")} readOnly={!canNavigate || !activeTab}
        value={draft ?? address} onChange={event => { setDraft(event.target.value); setInvalid(false); }}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => {
          if (event.key !== "Escape") return;
          setDraft(undefined);
          setInvalid(false);
          event.stopPropagation();
        }} />
      {invalid && <span role="alert" className="live-browser-address-error">{translate("Enter an HTTP or HTTPS address.")}</span>}
    </form>
  </div>;
}
