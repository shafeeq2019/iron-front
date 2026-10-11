import type { Screen } from '../App';

export function MainMenu({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="screen menu">
      <div className="screen-bg animated" />
      <div className="radar-sweep" />
      <div className="menu-inner">
        <div className="logo">
          <div className="logo-top">IRON FRONT</div>
          <div className="logo-sub">GLOBAL CONFLICT</div>
        </div>
        <nav className="menu-buttons">
          <button className="btn primary big" onClick={() => go('skirmish')}>Skirmish vs AI</button>
          <button className="btn big" onClick={() => go('multiplayer')}>Multiplayer</button>
          <button className="btn big" onClick={() => go('howto')}>How to Play</button>
          <button className="btn big" onClick={() => go('settings')}>Settings</button>
        </nav>
        <div className="menu-foot">An original real-time strategy game · v0.1 · all art and audio generated procedurally</div>
      </div>
    </div>
  );
}
