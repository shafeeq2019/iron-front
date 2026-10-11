import { useState } from 'react';
import { normalizeCode, normalizeName } from '@iron/shared';
import { getSettings, updateSettings } from '../../game/settings';
import { useStore } from '../../game/store';
import { connect, emitAck, net } from '../../net/socket';
import { Screen } from '../common';

export function MultiplayerMenu({ back, inviteCode, onJoined }: { back: () => void; inviteCode: string | null; onJoined: () => void }) {
  const [name, setName] = useState(getSettings().playerName || 'Commander');
  const [code, setCode] = useState(normalizeCode(inviteCode ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = useStore(net);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const n = normalizeName(name);
      updateSettings({ playerName: n });
      await connect();
      await fn();
      onJoined();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Multiplayer" back={back}>
      <p className="muted">Play online against friends. Create a room and share the code or invite link, or join a friend's room.</p>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="mp-grid">
        <div className="mp-card">
          <h3>Create a match</h3>
          <p className="muted small">You will be the host and choose the map.</p>
          <button className="btn primary" disabled={busy} onClick={() => run(() => emitAck('room:create', { name: normalizeName(name) }))}>Create Room</button>
        </div>
        <div className="mp-card">
          <h3>Join a match</h3>
          <input
            className="code-input"
            placeholder="ROOM CODE"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            aria-label="Room code"
          />
          <button className="btn primary" disabled={busy || code.length < 4} onClick={() => run(() => emitAck('room:join', { code, name: normalizeName(name) }))}>Join Room</button>
        </div>
      </div>
      {busy && <p className="muted">Connecting…</p>}
      {(error || st.error) && <p className="warn">{error ?? st.error}</p>}
      <p className="muted small">Server status: {st.status === 'connected' ? '🟢 connected' : st.status === 'connecting' ? '🟡 connecting' : st.status === 'error' ? '🔴 unreachable' : '⚪ not connected'}</p>
    </Screen>
  );
}
