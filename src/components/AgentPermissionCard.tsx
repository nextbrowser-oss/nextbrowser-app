import { translate } from "../shared/lib/i18n";
import { useEffect, useState } from 'react';
import { Check, Folder, ShieldCheck, SquareTerminal, X } from 'lucide-react';
import { Button } from '../shared/ui';
import { invoke } from '../electronBridge';

export interface AgentPermissionRequest {
  id: string;
  owner: string;
  workspaceId: string;
  conversationId: string;
  title: string;
  detail: string;
  folder: string;
  shell?: string;
  canRemember: boolean;
}

type RequestTarget = Pick<AgentPermissionRequest, 'id' | 'owner' | 'workspaceId' | 'conversationId'>;

export function useAgentPermission(owner: string | undefined, workspaceId: string | undefined, open: (id: string) => void) {
  const [pending, setPending] = useState<AgentPermissionRequest | null>(null);
  useEffect(() => {
    const bridge = window.nextbrowser;
    setPending(null);
    if (!bridge || !owner || !workspaceId) return;
    let revision = 0;
    async function refresh(target?: RequestTarget) {
      const seq = ++revision;
      try {
        const value = await invoke<AgentPermissionRequest | null>('stock_mcp_pending', { workspaceId });
        if (seq !== revision) return;
        const current = value && value.workspaceId === workspaceId && value.owner === owner ? value : null;
        setPending(current);
        if (target && current?.id === target.id && current.conversationId === target.conversationId) open(current.conversationId);
      } catch {
        if (seq === revision) setPending(null);
      }
    }
    const offChanged = bridge.on('stock-mcp:permission-changed', () => void refresh());
    const offOpen = bridge.on('stock-mcp:permission-open', value => {
      const target = value as RequestTarget;
      if (target.owner === owner && target.workspaceId === workspaceId) void refresh(target);
    });
    void refresh();
    return () => { revision++; offChanged(); offOpen(); };
  }, [owner, workspaceId, open]);
  return pending && pending.owner === owner && pending.workspaceId === workspaceId ? pending : null;
}

export function AgentPermissionCard({ request }: { request: AgentPermissionRequest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function answer(decision: 'deny' | 'once' | 'remember') {
    if (busy) return;
    setBusy(true);
    try {
      const { id, conversationId, workspaceId } = request;
      if (!await invoke<boolean>('stock_mcp_answer', { id, conversationId, workspaceId, decision })) setError(translate("This request is no longer active."));
    } catch {
      setError(translate("Could not send your decision. Try again."));
      setBusy(false);
    }
  }
  return <section className="agent-permission-card" aria-label={translate("Agent permission request")}>
    <div className="agent-permission-heading" role="status"><ShieldCheck size={18} /><strong>{request.title}</strong></div>
    <div className="agent-permission-context">
      {request.shell && <span><SquareTerminal size={13} />{request.shell}</span>}
      <span><Folder size={13} />{request.folder}</span>
    </div>
    <pre tabIndex={0} dir="ltr">{request.detail}</pre>
    <div className="agent-permission-actions">
      {request.canRemember && <Button disabled={busy} onClick={() => void answer('remember')}>{translate("Remember this exact command")}</Button>}
      <Button disabled={busy} onClick={() => void answer('deny')}><X size={14} />{translate("Deny")}</Button>
      <Button className="primary" disabled={busy} onClick={() => void answer('once')}><Check size={14} />{translate("Allow once")}</Button>
    </div>
    {error && <span role="alert">{error}</span>}
  </section>;
}
