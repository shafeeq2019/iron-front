import { useEffect, useRef, useState } from 'react';
import { LocalConnection, RemoteConnection, type GameConnection } from '../game/connection';
import { GameController } from '../game/controller';
import { IS_TOUCH } from '../game/settings';
import { getSocket } from '../net/socket';
import type { GameConfig, Screen } from './App';
import { Hud } from './hud/Hud';

export function useMobileLayout() {
  const calc = () => IS_TOUCH || window.innerWidth < 820 || window.innerHeight < 480;
  const [m, setM] = useState(calc);
  useEffect(() => {
    const fn = () => setM(calc());
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return m;
}

export function GameScreen({ config, exit, restart }: { config: GameConfig; exit: (to: Screen) => void; restart: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctrl, setCtrl] = useState<GameController | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let conn: GameConnection;
    let c: GameController | null = null;
    // Defer heavy renderer setup so the loading screen paints first.
    const id = setTimeout(() => {
    try {
      if (config.kind === 'local') conn = new LocalConnection(config.mapId, config.players);
      else {
        const s = getSocket();
        if (!s) throw new Error('Not connected to the server');
        conn = new RemoteConnection(s, config.info.you, config.info.mapId);
      }
      c = new GameController(conn);
      c.attach(canvasRef.current!);
      setCtrl(c);
      (window as unknown as { __iron?: GameController }).__iron = c;
    } catch (e) {
      setError((e as Error).message);
    }
    }, 30);
    return () => { clearTimeout(id); c?.destroy(); };
  }, []);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" data-testid="game-canvas" />
      {ctrl && <Hud ctrl={ctrl} online={config.kind === 'remote'} exit={exit} restart={restart} />}
      {!ctrl && !error && (
        <div className="overlay loading"><div className="loading-box"><div className="spinner" /><div>Deploying forces…</div></div></div>
      )}
      {error && (
        <div className="overlay">
          <div className="panel"><p className="warn">{error}</p><button className="btn" onClick={() => exit('menu')}>Main menu</button></div>
        </div>
      )}
    </div>
  );
}
