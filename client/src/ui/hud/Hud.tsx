import { memo, useEffect, useRef, useState } from 'react';
import { DEFS, FACTIONS, TICK_RATE, type QueueCategory } from '@iron/shared';
import { audio } from '../../game/audio';
import { CATEGORIES, type BuildOption, type GameController, type HudState } from '../../game/controller';
import { iconFor } from '../../game/render/sprites';
import { getSettings, onSettings } from '../../game/settings';
import { useStore } from '../../game/store';
import { net } from '../../net/socket';
import type { Screen } from '../App';
import { formatTime } from '../common';
import { useMobileLayout } from '../GameScreen';
import { SettingsPanel } from '../screens/SettingsScreen';

const TAB_LABEL: Record<QueueCategory, string> = { building: 'Base', defense: 'Defense', infantry: 'Infantry', vehicle: 'Vehicles' };
const TAB_ICON: Record<QueueCategory, string> = { building: '🏗', defense: '🛡', infantry: '🪖', vehicle: '🚜' };
const TAB_KEYS: Record<string, QueueCategory> = { z: 'building', x: 'defense', c: 'infantry', v: 'vehicle' };
const ITEM_KEYS = ['q', 'w', 'e', 'r', 't', 'y'];

interface Props { ctrl: GameController; online: boolean; exit: (to: Screen) => void; restart: () => void }

export function Hud({ ctrl, online, exit, restart }: Props) {
  const h = useStore(ctrl.hud);
  const mobile = useMobileLayout();
  const [tab, setTab] = useState<QueueCategory>('building');
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [showFps, setShowFps] = useState(getSettings().showFps);
  const netSt = useStore(net);
  useEffect(() => onSettings((s) => setShowFps(s.showFps)), []);

  // Keep the camera able to reach the whole map behind the HUD panels.
  useEffect(() => {
    if (mobile) ctrl.setInsets(0, drawer ? 150 : 60, 44);
    else ctrl.setInsets(252, 0, 36);
  }, [mobile, drawer, ctrl]);

  useEffect(() => {
    ctrl.onPauseRequest = () => setMenu((m) => !m);
    ctrl.onHotkey = (k) => {
      if (TAB_KEYS[k]) { setTab(TAB_KEYS[k]); return; }
      const idx = ITEM_KEYS.indexOf(k);
      if (idx >= 0) {
        const opts = ctrl.hud.get().options[tabRef.current].filter((o) => o.available);
        const o = opts[idx];
        if (o) ctrl.buildClick(tabRef.current, o.type);
      }
    };
  }, [ctrl]);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Pause the local simulation while the menu is open.
  useEffect(() => {
    if (!online) ctrl.setPaused(menu);
  }, [menu, online, ctrl]);

  // Auto-switch to a tab with a ready structure.
  const readyCat = CATEGORIES.find((c) => h.queues[c].ready);
  const lastReady = useRef<string | null>(null);
  useEffect(() => {
    if (readyCat && lastReady.current !== readyCat) setTab(readyCat);
    lastReady.current = readyCat ?? null;
  }, [readyCat]);

  const ended = !!h.result;
  return (
    <div className={`hud ${mobile ? 'mobile' : 'desktop'}`}>
      <TopBar h={h} onMenu={() => setMenu(true)} mobile={mobile} ping={online ? netSt.ping : -1} onToggleMap={() => setShowMap((v) => !v)} />
      <Messages h={h} />
      {online && netSt.notice && <div className="banner warn">{netSt.notice}</div>}
      {h.defeated && !ended && <div className="banner">You have been defeated — spectating. <button className="btn small" onClick={() => exit('menu')}>Leave</button></div>}
      {showFps && <div className="perf">{h.fps} fps · {h.simInfo}</div>}
      {mobile ? (
        <>
          {showMap && <MinimapView ctrl={ctrl} className="minimap mobile-map" />}
          <MobileCommands ctrl={ctrl} h={h} />
          {h.mode === 'place' && <PlacementBar ctrl={ctrl} h={h} />}
          <div className={`drawer ${drawer ? 'open' : ''}`}>
            <div className="drawer-tabs">
              <button className="btn small toggle" onClick={() => setDrawer(!drawer)} aria-label="Toggle build menu">{drawer ? '▼' : '▲ Build'}</button>
              {CATEGORIES.map((c) => (
                <button key={c} className={`tab ${tab === c ? 'active' : ''} ${h.queues[c].ready ? 'flash' : ''}`} onClick={() => { setTab(c); setDrawer(true); }}>
                  {TAB_ICON[c]} <span>{TAB_LABEL[c]}</span>
                </button>
              ))}
            </div>
            {drawer && <BuildGrid ctrl={ctrl} h={h} cat={tab} mobile />}
          </div>
          <SelectionChip ctrl={ctrl} h={h} />
        </>
      ) : (
        <>
          <div className="sidebar">
            <MinimapView ctrl={ctrl} className="minimap" />
            <PowerBar h={h} />
            <div className="tabs">
              {CATEGORIES.map((c, i) => (
                <button key={c} className={`tab ${tab === c ? 'active' : ''} ${h.queues[c].ready ? 'flash' : ''}`} onClick={() => setTab(c)} title={`${TAB_LABEL[c]} (${'ZXCV'[i]})`}>
                  {TAB_ICON[c]}<span>{TAB_LABEL[c]}</span>
                </button>
              ))}
            </div>
            <BuildGrid ctrl={ctrl} h={h} cat={tab} />
            {h.sweep >= 0 && <SweepButton ctrl={ctrl} h={h} />}
          </div>
          <SelectionPanel ctrl={ctrl} h={h} />
          {h.mode === 'place' && <div className="hint">Left-click to place · Right-click / Esc to cancel</div>}
          {h.mode === 'attack' && <div className="hint">Attack-move: click a destination (Shift to keep the mode)</div>}
          {h.mode === 'sweep' && <div className="hint">Recon Sweep: click anywhere to reveal the area</div>}
        </>
      )}
      {menu && !ended && <PauseMenu ctrl={ctrl} online={online} close={() => setMenu(false)} exit={exit} />}
      {ended && <ResultScreen h={h} ctrl={ctrl} online={online} exit={exit} restart={restart} />}
    </div>
  );
}

function TopBar({ h, onMenu, mobile, ping, onToggleMap }: { h: HudState; onMenu: () => void; mobile: boolean; ping: number; onToggleMap: () => void }) {
  const low = h.power[1] > h.power[0];
  return (
    <div className="topbar">
      <button className="btn small" onClick={onMenu} aria-label="Menu">☰{mobile ? '' : ' Menu'}</button>
      <span className="credits" data-testid="credits">${h.credits.toLocaleString()}</span>
      <span className={`power ${low ? 'low' : ''}`} title="Power produced / used">⚡ {h.power[0]}/{h.power[1]}</span>
      <span className="clock">{formatTime(h.time)}</span>
      {ping >= 0 && <span className="ping">{ping}ms</span>}
      {mobile && <button className="btn small" onClick={onToggleMap} aria-label="Toggle minimap">🗺</button>}
    </div>
  );
}

function PowerBar({ h }: { h: HudState }) {
  const [p, u] = h.power;
  const max = Math.max(p, u, 100);
  return (
    <div className="powerbar" title={`Power: ${p} produced / ${u} used`}>
      <div className="fill" style={{ width: `${(p / max) * 100}%` }} />
      <div className={`use ${u > p ? 'low' : ''}`} style={{ left: `${Math.min(100, (u / max) * 100)}%` }} />
      <span>POWER {p} / {u}</span>
    </div>
  );
}

function Messages({ h }: { h: HudState }) {
  return (
    <div className="messages" aria-live="polite">
      {h.messages.map((m) => <div key={m.id} className={`msg ${m.kind}`}>{m.text}</div>)}
    </div>
  );
}

function MinimapView({ ctrl, className }: { ctrl: GameController; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    ctrl.setMinimapCanvas(ref.current);
    return () => ctrl.setMinimapCanvas(null);
  }, [ctrl]);
  const nav = (e: React.PointerEvent<HTMLCanvasElement>, command: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    ctrl.minimapNavigate(e.clientX - r.left, e.clientY - r.top, command);
  };
  return (
    <canvas
      ref={ref}
      className={className}
      width={220}
      height={220}
      onPointerDown={(e) => { e.stopPropagation(); if (e.button === 2) { nav(e, true); return; } dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); nav(e, false); }}
      onPointerMove={(e) => dragging.current && nav(e, false)}
      onPointerUp={() => (dragging.current = false)}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="minimap"
    />
  );
}

const BuildButton = memo(function BuildButton({ o, cat, ctrl, h, idx }: { o: BuildOption; cat: QueueCategory; ctrl: GameController; h: HudState; idx: number }) {
  const q = h.queues[cat];
  const queued = q.items.filter((i) => i[0] === o.type);
  const active = q.items[0]?.[0] === o.type ? q.items[0][1] : queued.length ? 0 : -1;
  const ready = q.ready === o.type;
  const structureBusy = (cat === 'building' || cat === 'defense') && (q.items.length > 0 || !!q.ready) && !ready && !queued.length;
  const afford = h.credits >= o.cost;
  const disabled = !o.available || structureBusy;
  const icon = iconFor(o.type, h.color, h.faction);
  return (
    <button
      className={`build ${ready ? 'ready' : ''} ${disabled ? 'disabled' : ''} ${!afford && !ready && !queued.length ? 'poor' : ''}`}
      onClick={() => (disabled ? audio.play('error') : ctrl.buildClick(cat, o.type))}
      onContextMenu={(e) => { e.preventDefault(); if (queued.length || ready) ctrl.buildCancel(cat, o.type); }}
      title={`${o.name} — $${o.cost}\n${o.description}${o.missing.length ? `\nRequires: ${o.missing.join(', ')}` : ''}\n(Right-click to cancel)`}
      data-testid={`build-${o.type}`}
    >
      <img src={icon} alt="" draggable={false} />
      {active >= 0 && !ready && <div className="progress" style={{ ['--p' as string]: `${active * 360}deg` }} />}
      <span className="bname">{o.name}</span>
      <span className="bcost">${o.cost}</span>
      {ITEM_KEYS[idx] && o.available && <span className="hk">{ITEM_KEYS[idx].toUpperCase()}</span>}
      {queued.length > 1 && <span className="count">{queued.length}</span>}
      {ready && <span className="ready-label">READY</span>}
      {q.onHold && active >= 0 && <span className="ready-label hold">ON HOLD</span>}
      {!o.available && <span className="lock">🔒</span>}
      {(queued.length > 0 || ready) && (
        <span className="cancel" role="button" aria-label="Cancel" onClick={(e) => { e.stopPropagation(); ctrl.buildCancel(cat, o.type); }}>✕</span>
      )}
    </button>
  );
});

function BuildGrid({ ctrl, h, cat, mobile }: { ctrl: GameController; h: HudState; cat: QueueCategory; mobile?: boolean }) {
  const opts = h.options[cat];
  const avail = opts.filter((o) => o.available);
  return (
    <div className={`build-grid ${mobile ? 'row' : ''}`}>
      {opts.map((o) => <BuildButton key={o.type} o={o} cat={cat} ctrl={ctrl} h={h} idx={avail.indexOf(o)} />)}
      {!opts.length && <div className="muted small">Nothing available</div>}
    </div>
  );
}

function SweepButton({ ctrl, h }: { ctrl: GameController; h: HudState }) {
  const ready = h.sweep === 0;
  return (
    <button className={`btn sweep ${ready ? 'primary' : ''}`} disabled={!ready} onClick={() => ctrl.setMode('sweep')} data-testid="sweep">
      📡 Recon Sweep {ready ? '' : `(${Math.ceil(h.sweep / TICK_RATE)}s)`}
    </button>
  );
}

function SelectionPanel({ ctrl, h }: { ctrl: GameController; h: HudState }) {
  const s = h.selection;
  const p = s.primary;
  if (!p && !s.count) return null;
  return (
    <div className="selpanel">
      {p && (
        <div className="selhead">
          <img src={iconFor(p.type, p.owner === -1 ? '#a8a49a' : h.players[p.owner]?.color ?? h.color, h.players[p.owner]?.faction ?? h.faction)} alt="" />
          <div className="selinfo">
            <div className="selname">{s.count > 1 ? `${s.count} units selected` : p.name}</div>
            {s.count <= 1 && <div className="muted small">{p.mine ? p.description : `${p.ownerName}`}</div>}
            {s.count <= 1 && (
              <div className="hpbar"><div style={{ width: `${(p.hp / p.maxHp) * 100}%` }} /><span>{p.hp} / {p.maxHp}</span></div>
            )}
            {p.cargo >= 0 && s.count <= 1 && <div className="muted small">Cargo {p.cargo}%</div>}
          </div>
        </div>
      )}
      {s.count > 1 && (
        <div className="groups">
          {s.groups.map((g) => (
            <button key={g.type} className="grp" onClick={() => ctrl.selectSameTypeOnScreen(g.type)} title={g.name}>
              <img src={iconFor(g.type, h.color, h.faction)} alt="" /><span>{g.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cmds">
        {s.hasUnits && <button className={`btn small ${h.mode === 'attack' ? 'primary' : ''}`} onClick={() => ctrl.setMode('attack')} title="Attack-move (A)">⚔ Attack-move</button>}
        {s.hasUnits && <button className="btn small" onClick={() => ctrl.stop()} title="Stop (S)">■ Stop</button>}
        {s.canDeploy && <button className="btn small primary" onClick={() => ctrl.deploy()} title="Deploy (D)" data-testid="deploy">⤓ Deploy</button>}
        {p?.isBuilding && p.mine && <button className={`btn small ${p.repairing ? 'primary' : ''}`} onClick={() => ctrl.repairSelected()}>🔧 Repair</button>}
        {p?.isBuilding && p.mine && <button className="btn small danger" onClick={() => ctrl.sellSelected()}>$ Sell</button>}
        {p?.producer && p.mine && <span className="muted small">Right-click the map to set a rally point</span>}
      </div>
    </div>
  );
}

function SelectionChip({ ctrl, h }: { ctrl: GameController; h: HudState }) {
  const s = h.selection, p = s.primary;
  if (!p) return null;
  return (
    <div className="selchip">
      <img src={iconFor(p.type, h.players[p.owner]?.color ?? '#a8a49a', h.players[p.owner]?.faction ?? h.faction)} alt="" />
      <div>
        <div className="selname">{s.count > 1 ? `${s.count} selected` : p.name}</div>
        <div className="hpbar small"><div style={{ width: `${(p.hp / p.maxHp) * 100}%` }} /></div>
      </div>
      {p.isBuilding && p.mine && (
        <>
          <button className={`btn small ${p.repairing ? 'primary' : ''}`} onClick={() => ctrl.repairSelected()} aria-label="Repair">🔧</button>
          <button className="btn small danger" onClick={() => ctrl.sellSelected()} aria-label="Sell">$</button>
        </>
      )}
    </div>
  );
}

function MobileCommands({ ctrl, h }: { ctrl: GameController; h: HudState }) {
  const s = h.selection;
  return (
    <div className="mcmds">
      <button className={`mbtn ${h.boxSelect ? 'on' : ''}`} onClick={() => ctrl.toggleBoxSelect()} aria-label="Box select">▢</button>
      <button className="mbtn" onClick={() => ctrl.selectAllArmy()} aria-label="Select army">⚑</button>
      {s.count > 0 && <button className="mbtn" onClick={() => ctrl.deselect()} aria-label="Deselect">✕</button>}
      {s.hasUnits && <button className={`mbtn ${h.mode === 'attack' ? 'on' : ''}`} onClick={() => ctrl.setMode(h.mode === 'attack' ? 'normal' : 'attack')} aria-label="Attack move">⚔</button>}
      {s.hasUnits && <button className="mbtn" onClick={() => ctrl.stop()} aria-label="Stop">■</button>}
      {s.canDeploy && <button className="mbtn on" onClick={() => ctrl.deploy()} aria-label="Deploy" data-testid="deploy">⤓</button>}
      <button className="mbtn" onClick={() => ctrl.centerOnSelection()} aria-label="Center camera">◎</button>
      {h.sweep >= 0 && <button className={`mbtn ${h.sweep === 0 ? 'on' : ''}`} disabled={h.sweep > 0} onClick={() => ctrl.setMode('sweep')} aria-label="Recon sweep">📡</button>}
    </div>
  );
}

function PlacementBar({ ctrl, h }: { ctrl: GameController; h: HudState }) {
  return (
    <div className="placebar">
      <span>Drag or tap to position {h.placement ? DEFS[h.placement]?.name : ''}</span>
      <button className="btn primary" disabled={!h.placementValid} onClick={() => ctrl.confirmPlacement()} data-testid="confirm-place">✔ Place</button>
      <button className="btn" onClick={() => ctrl.setMode('normal')}>✖</button>
    </div>
  );
}

function PauseMenu({ ctrl, online, close, exit }: { ctrl: GameController; online: boolean; close: () => void; exit: (to: Screen) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <div className="overlay">
      <div className="panel pause">
        <h2>{online ? 'Menu' : 'Paused'}</h2>
        {online && <p className="muted small">Online matches keep running while this menu is open.</p>}
        {settings ? (
          <>
            <SettingsPanel />
            <button className="btn" onClick={() => setSettings(false)}>Done</button>
          </>
        ) : (
          <div className="menu-buttons">
            <button className="btn primary" onClick={close}>Resume</button>
            <button className="btn" onClick={() => setSettings(true)}>Settings</button>
            {!confirm ? (
              <button className="btn danger" onClick={() => setConfirm(true)}>Surrender</button>
            ) : (
              <button className="btn danger" onClick={() => { ctrl.surrender(); close(); }}>Confirm surrender</button>
            )}
            <button className="btn" onClick={() => { if (online) ctrl.surrender(); exit('menu'); }}>Quit to main menu</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultScreen({ h, ctrl, online, exit, restart }: { h: HudState; ctrl: GameController; online: boolean; exit: (to: Screen) => void; restart: () => void }) {
  const r = h.result!;
  const won = r.winners.includes(ctrl.world.playerId);
  return (
    <div className="overlay result">
      <div className={`panel result-panel ${won ? 'victory' : 'defeat'}`}>
        <h1 data-testid="result-title">{won ? 'VICTORY' : 'DEFEAT'}</h1>
        <p className="muted">{formatTime(r.tick / TICK_RATE)} · {won ? 'The enemy has been eliminated.' : 'Your forces have been eliminated.'}</p>
        <table className="stats">
          <thead><tr><th>Commander</th><th>Faction</th><th>Built</th><th>Lost</th><th>Kills</th><th>Structures</th><th>Earned</th></tr></thead>
          <tbody>
            {r.stats.map((s) => (
              <tr key={s.id} className={r.winners.includes(s.id) ? 'win' : ''}>
                <td><span className="swatch tiny" style={{ background: s.color }} /> {s.name}</td>
                <td>{FACTIONS[s.faction].short}</td>
                <td>{s.stats.unitsBuilt}</td>
                <td>{s.stats.unitsLost}</td>
                <td>{s.stats.kills}</td>
                <td>{s.stats.buildingsBuilt}/{s.stats.buildingsLost}</td>
                <td>${s.stats.creditsEarned.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="menu-buttons row">
          {online ? <button className="btn primary" onClick={() => exit('lobby')}>Back to lobby (rematch)</button> : <button className="btn primary" onClick={restart}>Play again</button>}
          <button className="btn" onClick={() => exit('menu')}>Main menu</button>
        </div>
      </div>
    </div>
  );
}
