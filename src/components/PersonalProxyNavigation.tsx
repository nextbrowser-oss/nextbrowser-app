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
  return <Popover label="Personal proxies" open={open} onOpenChange={changeOpen} openOnHover side="right" align="start"
    className="personal-proxy-popover shared-scrollbarless" trigger={props => <button {...props}
      className="sidebar-destination" aria-label="Personal proxy">
      <Glyph name="network" /><span className="sidebar-destination-label">Personal proxy</span>
      {count > 0 && <span className="sidebar-destination-count" aria-hidden="true">{count}</span>}
    </button>}>
    <div className="live-session-tools">
      <label className="live-session-search"><Icon name="magnifyingglass" size={14} />
        <input type="search" aria-label="Search personal proxies" placeholder="Search proxies" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <IconButton label="Create proxy" appearance="plain" size="small" onClick={() => create(false)}><Icon name="plus" size={14} /></IconButton>
      <IconButton label="Import proxies" appearance="plain" size="small" onClick={() => create(true)}><Glyph name="download" size={14} /></IconButton>
    </div>
    {renderList(query)}
  </Popover>;
}
