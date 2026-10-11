import { useState } from 'react';
import { allMaps, FACTIONS, PLAYER_COLORS, type Difficulty, type FactionId, type LobbySlot } from '@iron/shared';
import { useStore } from '../../game/store';
import { emit, emitAck, leaveRoom, net } from '../../net/socket';
import { MapPreview, Screen } from '../common';

export function Lobby({ back }: { back: () => void }) {
  const st = useStore(net);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lobby = st.lobby;
  if (!lobby) {
    return (
      <Screen title="Lobby" back={back}>
        <p className="muted">{st.error ?? 'Not in a room.'}</p>
      </Screen>
    );
  }
  const mySlot = lobby.slots.find((s) => s.slotId === lobby.you);
  const isHost = mySlot?.slotId === lobby.hostSlot;
  const humans = lobby.slots.filter((s) => !s.isAI);
  const allReady = humans.every((s) => s.ready || s.slotId === lobby.hostSlot);
  const teams = new Set(lobby.slots.map((s) => s.team));
  const canStart = isHost && lobby.slots.length >= 2 && teams.size >= 2 && allReady;
  const invite = `${window.location.origin}${window.location.pathname}?room=${lobby.code}`;
  const taken = lobby.slots.map((s) => s.color);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — share the room code instead.');
    }
  };
  const start = async () => {
    setError(null);
    try { await emitAck('room:start'); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen title={`Room ${lobby.code}`} back={() => { leaveRoom(); back(); }} wide>
      <div className="lobby-head">
        <div className="room-code" data-testid="room-code">{lobby.code}</div>
        <div className="invite">
          <input readOnly value={invite} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button className="btn small" onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</button>
        </div>
      </div>
      {lobby.lastResult && (
        <p className="muted">Last match: {lobby.lastResult.winners.length ? `${lobby.lastResult.stats.filter((s) => lobby.lastResult!.winners.includes(s.id)).map((s) => s.name).join(', ')} won` : 'draw'} — ready up for a rematch.</p>
      )}
      <div className="setup-grid">
        <section>
          <h3>Players ({lobby.slots.length}/{lobby.maxPlayers})</h3>
          <div className="slots">
            {lobby.slots.map((s) => (
              <SlotRow key={s.slotId} slot={s} mine={s.slotId === mySlot?.slotId} host={isHost} hostSlot={lobby.hostSlot} taken={taken} />
            ))}
          </div>
          {isHost && lobby.slots.length < lobby.maxPlayers && (
            <div className="row">
              <button className="btn small" onClick={() => emit('room:addAI', { difficulty: 'normal' })}>+ Add AI</button>
            </div>
          )}
        </section>
        <section>
          <h3>Map</h3>
          <div className="map-list">
            {allMaps().map((m) => (
              <button key={m.id} disabled={!isHost} className={`map-item ${m.id === lobby.mapId ? 'active' : ''}`} onClick={() => emit('room:map', { mapId: m.id })}>
                <MapPreview mapId={m.id} size={64} />
                <div>
                  <div className="map-name">{m.name}</div>
                  <div className="muted">{m.maxPlayers} players · {m.theme}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="actions">
            {!isHost && mySlot && (
              <button className={`btn big ${mySlot.ready ? '' : 'primary'}`} onClick={() => emit('room:update', { ready: !mySlot.ready })}>
                {mySlot.ready ? 'Not ready' : 'Ready ✔'}
              </button>
            )}
            {isHost && <button className="btn primary big" disabled={!canStart} onClick={start}>Start Match ▶</button>}
          </div>
          {isHost && !canStart && <p className="muted small">{lobby.slots.length < 2 ? 'Waiting for another player (or add an AI).' : teams.size < 2 ? 'Players must be on at least two teams.' : 'Waiting for all players to be ready.'}</p>}
          {!isHost && <p className="muted small">The host starts the match when everyone is ready.</p>}
          {error && <p className="warn">{error}</p>}
          {st.notice && <p className="muted">{st.notice}</p>}
        </section>
      </div>
    </Screen>
  );
}

function SlotRow({ slot, mine, host, hostSlot, taken }: { slot: LobbySlot; mine: boolean; host: boolean; hostSlot: number; taken: string[] }) {
  const editable = mine || (host && slot.isAI);
  const update = (p: { faction?: FactionId; color?: string; team?: number; difficulty?: Difficulty }) => {
    if (slot.isAI) emit('room:aiUpdate', { slotId: slot.slotId, ...p });
    else emit('room:update', p);
  };
  return (
    <div className={`slot ${mine ? 'mine' : ''}`} data-testid="lobby-slot">
      <span className="swatch tiny" style={{ background: slot.color }} />
      <span className="slot-name">
        {slot.name}
        {slot.slotId === hostSlot && <span className="badge">HOST</span>}
        {slot.isAI && <span className="badge">AI</span>}
        {!slot.connected && !slot.isAI && <span className="badge warn">offline</span>}
      </span>
      <select disabled={!editable} value={slot.faction} onChange={(e) => update({ faction: e.target.value as FactionId })} aria-label="Faction">
        {(Object.keys(FACTIONS) as FactionId[]).map((f) => <option key={f} value={f}>{FACTIONS[f].short}</option>)}
      </select>
      {slot.isAI && (
        <select disabled={!editable} value={slot.difficulty} onChange={(e) => update({ difficulty: e.target.value as Difficulty })} aria-label="Difficulty">
          <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
        </select>
      )}
      <select disabled={!editable} value={slot.team} onChange={(e) => update({ team: Number(e.target.value) })} aria-label="Team">
        {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Team {t}</option>)}
      </select>
      <select disabled={!editable} value={slot.color} onChange={(e) => update({ color: e.target.value })} aria-label="Color" style={{ color: slot.color }}>
        {PLAYER_COLORS.map((c) => <option key={c} value={c} disabled={taken.includes(c) && c !== slot.color} style={{ color: c }}>■ {c}</option>)}
      </select>
      <span className={`ready ${slot.ready || slot.isAI || slot.slotId === hostSlot ? 'yes' : ''}`}>{slot.isAI || slot.slotId === hostSlot ? '' : slot.ready ? 'READY' : '…'}</span>
      {host && !mine && <button className="btn ghost small" onClick={() => emit('room:kick', { slotId: slot.slotId })} aria-label="Remove">✕</button>}
    </div>
  );
}
