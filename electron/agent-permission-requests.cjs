const { randomUUID } = require('node:crypto');

function createPermissionRequests({ Notification, isCurrent }) {
  const pending = new Map();

  function get(scope) {
    const entry = pending.get(scope);
    return entry && isCurrent(scope) && !entry.signal.aborted ? entry.data : null;
  }

  function answer(scope, { id, conversationId, decision }) {
    const data = get(scope);
    if (!data || data.id !== id || data.conversationId !== conversationId) return false;
    if (decision !== 'deny' && decision !== 'once' && !(decision === 'remember' && data.canRemember)) return false;
    pending.get(scope).finish(decision);
    return true;
  }

  function request(scope, conversationId, prompt, signal) {
    signal.throwIfAborted();
    if (!isCurrent(scope) || !conversationId || pending.has(scope)) throw Error('No active chat is available for this permission request.');
    const window = scope.window;
    const data = { ...prompt, id: randomUUID(), owner: scope.owner, workspaceId: scope.workspaceId, conversationId };
    const changed = () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('stock-mcp:permission-changed');
    };
    return new Promise((resolve, reject) => {
      let toast;
      function finish(decision) {
        if (pending.get(scope)?.data !== data) return;
        pending.delete(scope);
        signal.removeEventListener('abort', cancel);
        window.off('closed', cancel);
        window.off('blur', notify);
        window.off('hide', notify);
        window.off('minimize', notify);
        toast?.close();
        if (!window.isDestroyed()) window.flashFrame(false);
        changed();
        if (decision) resolve(decision);
        else reject(Error('The permission request expired or the agent stopped.'));
      }
      function cancel() { finish(); }
      function review() {
        if (get(scope)?.id !== data.id) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.send('stock-mcp:permission-open', { id: data.id, owner: data.owner, workspaceId: data.workspaceId, conversationId });
      }
      function attention() {
        if (get(scope)?.id === data.id) window.flashFrame(true);
      }
      function notify() {
        if (toast || get(scope)?.id !== data.id) return;
        try {
          if (!Notification.isSupported()) return attention();
          // Only offer one-click approval if the entire operation fits in the notification.
          const quick = !!prompt.notificationDetail;
          toast = new Notification({ id: data.id, title: prompt.title, body: prompt.notificationDetail || 'Review the details in your Nextbrowser chat.',
            actions: [{ type: 'button', text: quick ? 'Allow once' : 'Review' }, { type: 'button', text: 'Deny' }] });
          toast.on('click', review);
          toast.on('action', (event, legacyIndex) => {
            const index = event.actionIndex ?? legacyIndex;
            if (index === 0 && !quick) review();
            else if (index === 0 || index === 1) answer(scope, { id: data.id, conversationId, decision: index === 0 ? 'once' : 'deny' });
          });
          toast.on('failed', attention);
          toast.show();
        } catch { attention(); }
      }
      pending.set(scope, { data, signal, finish });
      signal.addEventListener('abort', cancel, { once: true });
      window.once('closed', cancel);
      window.on('blur', notify);
      window.on('hide', notify);
      window.on('minimize', notify);
      changed();
      if (!window.isVisible() || window.isMinimized() || !window.isFocused()) notify();
    });
  }
  return { request, get, answer };
}

module.exports = { createPermissionRequests };
