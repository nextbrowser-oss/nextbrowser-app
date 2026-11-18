import { useState } from 'react';
import { Button, Tooltip } from '../shared/ui';
import { invoke } from '../electronBridge';

export function SettingsDiagnostics() {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [cliStatus, setCliStatus] = useState('available');
  const copy = async () => {
    if (status === 'copying') return;
    setStatus('copying');
    try { const result = await invoke<{ cliStatus?: string }>('support_diagnostics_copy'); setCliStatus(result?.cliStatus || 'unavailable'); setStatus('copied'); }
    catch { setStatus('error'); }
  };
  return <div className="settings-row">
    <div><strong>Support diagnostics</strong><p className="muted small">Versions, configuration, authorization and recent error references.</p>
      {status === 'error' && <p className="small" role="alert">Couldn't copy diagnostics. Try again.</p>}
      {status === 'copied' && <p className="small" role="status">{cliStatus === 'available' ? 'Diagnostics copied.' : cliStatus === 'upgrade_required' ? 'Diagnostics copied. Update nextctl for a complete report.' : 'Diagnostics copied. CLI details are currently unavailable.'}</p>}
    </div>
    <Tooltip content="Copy a support report without API keys, cookies, proxy passwords or chat contents">
      <Button className="secondary small" disabled={status === 'copying'} onClick={() => { void copy(); }}>{status === 'copying' ? 'Collecting…' : 'Copy diagnostics'}</Button>
    </Tooltip>
  </div>;
}
