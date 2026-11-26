import { translate } from "../shared/lib/i18n";
import { useState, type ReactNode } from "react";
import { Glyph, IconButton, Popover } from "../shared/ui";
import { Icon } from "./Icon";

export function PersonalProxyNavigation({ count, onLoad, onCreate, renderList }: {
  count: number; onLoad: () => void; onCreate: (bulk: boolean) => void; renderList: (query: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next && !open) onLoad();
    if (!next) setQuery("");
  };
  const create = (bulk: boolean) => { changeOpen(false); onCreate(bulk); };
  return <Popover label={translate("Personal proxies")} open={open} onOpenChange={changeOpen} openOnHover side="right" align="start"
    className="personal-proxy-popover shared-scrollbarless" trigger={props => <button {...props}
      className="sidebar-destination" aria-label={translate("Personal proxy")}>
      <Glyph name="network" />
      {count > 0 && <span className="sidebar-destination-count" aria-hidden="true">{count}</span>}
    </button>}>
    <div className="rail-popover-heading">{translate("Personal proxy")}</div>
    <div className="live-session-tools">
      <label className="live-session-search"><Icon name="magnifyingglass" size={14} />
        <input type="search" aria-label={translate("Search personal proxies")} placeholder={translate("Search proxies")} value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <IconButton label={translate("Create proxy")} appearance="plain" size="small" onClick={() => create(false)}><Icon name="plus" size={14} /></IconButton>
      <IconButton label={translate("Import proxies")} appearance="plain" size="small" onClick={() => create(true)}><Glyph name="download" size={14} /></IconButton>
    </div>
    {renderList(query)}
  </Popover>;
}
