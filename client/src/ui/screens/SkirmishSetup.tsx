import { useState } from 'react';
import { allMaps, FACTIONS, PLAYER_COLORS, normalizeName, type Difficulty, type FactionId, type PlayerSetup } from '@iron/shared';
import { getSettings, updateSettings } from '../../game/settings';
import type { GameConfig } from '../App';
import { ColorPicker, FactionPicker, MapPreview, Screen } from '../common';

interface AISlot { faction: FactionId; difficulty: Difficulty; color: string; team: number }

const AI_NAMES = ['Gen. Volkov', 'Col. Hargreave', 'Cmdr. Anika', 'Maj. Tessaro', 'Adm. Kerrigan'];

export function SkirmishSetup({ back, start }: { back: () => void; start: (c: GameConfig) => void }) {
  const maps = allMaps();
  const [name, setName] = useState(getSettings().playerName || 'Commander');
  const [faction, setFaction] = useState<FactionId>('cdc');
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [mapId, setMapId] = useState(maps[0].id);
  const [ais, setAis] = useState<AISlot[]>([{ faction: 'esd', difficulty: 'normal', color: PLAYER_COLORS[1], team: 2 }]);
  const map = maps.find((m) => m.id === mapId)!;

  const setAi = (i: number, p: Partial<AISlot>) => setAis(ais.map((a, k) => (k === i ? { ...a, ...p } : a)));
  const addAi = () => {
    if (ais.length + 1 >= map.maxPlayers) return;
    const used = [color, ...ais.map((a) => a.color)];
    setAis([...ais, { faction: Math.random() < 0.5 ? 'cdc' : 'esd', difficulty: 'normal', color: PLAYER_COLORS.find((c) => !used.includes(c))!, team: ais.length + 2 }]);
  };
  const chooseMap = (id: string) => {
    setMapId(id);
    const m = maps.find((x) => x.id === id)!;
    if (ais.length + 1 > m.maxPlayers) setAis(ais.slice(0, m.maxPlayers - 1));
  };

  const go = () => {
    const n = normalizeName(name);
    updateSettings({ playerName: n });
    const players: PlayerSetup[] = [
      { name: n, faction, color, team: 1, isAI: false },
      ...ais.map((a, i) => ({ name: `${AI_NAMES[i % AI_NAMES.length]} (${a.difficulty})`, faction: a.faction, color: a.color, team: a.team, isAI: true, difficulty: a.difficulty })),
    ];
    start({ kind: 'local', mapId, players });
  };

  const teamsOk = new Set([1, ...ais.map((a) => a.team)]).size > 1;

  return (
    <Screen title="Skirmish Setup" back={back} wide>
      <div className="setup-grid">
        <section>
          <h3>Commander</h3>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field"><span>Color</span></label>
          <ColorPicker value={color} onChange={setColor} taken={ais.map((a) => a.color)} />
          <h3>Faction</h3>
          <FactionPicker value={faction} onChange={setFaction} color={color} />
        </section>
        <section>
          <h3>Battlefield</h3>
          <div className="map-list">
            {maps.map((m) => (
              <button key={m.id} className={`map-item ${m.id === mapId ? 'active' : ''}`} onClick={() => chooseMap(m.id)}>
                <MapPreview mapId={m.id} size={72} />
                <div>
                  <div className="map-name">{m.name}</div>
                  <div className="muted">{m.width}×{m.height} · {m.maxPlayers} players · {m.theme}</div>
                </div>
              </button>
            ))}
          </div>
          <p className="muted small">{map.description}</p>
          <h3>Opponents</h3>
          {ais.map((a, i) => (
            <div key={i} className="ai-row">
              <select value={a.faction} onChange={(e) => setAi(i, { faction: e.target.value as FactionId })} aria-label="AI faction">
                {(Object.keys(FACTIONS) as FactionId[]).map((f) => <option key={f} value={f}>{FACTIONS[f].short}</option>)}
              </select>
              <select value={a.difficulty} onChange={(e) => setAi(i, { difficulty: e.target.value as Difficulty })} aria-label="AI difficulty">
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
              <select value={a.team} onChange={(e) => setAi(i, { team: Number(e.target.value) })} aria-label="AI team">
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Team {t}{t === 1 ? ' (yours)' : ''}</option>)}
              </select>
              <span className="swatch tiny" style={{ background: a.color }} />
              {ais.length > 1 && <button className="btn ghost small" onClick={() => setAis(ais.filter((_, k) => k !== i))} aria-label="Remove AI">✕</button>}
            </div>
          ))}
          {ais.length + 1 < map.maxPlayers && <button className="btn small" onClick={addAi}>+ Add AI opponent</button>}
          {!teamsOk && <p className="warn">At least one opponent must be on another team.</p>}
          <div className="actions">
            <button className="btn primary big" disabled={!teamsOk} onClick={go}>Deploy ▶</button>
          </div>
        </section>
      </div>
    </Screen>
  );
}
