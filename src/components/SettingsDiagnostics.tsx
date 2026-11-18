import { useState } from 'react';
import { Button, Tooltip } from '../shared/ui';
import { invoke } from '../electronBridge';

export function SettingsDiagnostics() {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [partial, setPartial] = useState(false);
  const copy = async () => {
    if (status === 'copying') return;
    setStatus('copying');
    try { const result = await invoke<{ cliStatus?: string }>('support_diagnostics_copy'); setPartial(result?.cliStatus !== 'available'); setStatus('copied'); }
    catch { setStatus('error'); }
  };
  return <div className="settings-row">
    <div><strong>Support diagnostics</strong><p className="muted small">Versions, configuration, authorization and recent error references.</p>
      {status === 'error' && <p className="small" role="alert">Couldn't copy diagnostics. Try again.</p>}
      {status === 'copied' && <p className="small" role="status">{partial ? 'Diagnostics copied. Update nextctl for a complete report.' : 'Diagnostics copied.'}</p>}
    </div>
    <Tooltip content="Copy a support report without API keys, cookies, proxy passwords or chat contents">
      <Button className="secondary small" disabled={status === 'copying'} onClick={() => { void copy(); }}>{status === 'copying' ? 'Collecting…' : 'Copy diagnostics'}</Button>
    </Tooltip>
  </div>;
}
