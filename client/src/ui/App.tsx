import { useEffect, useState } from 'react';
import type { GameStartInfo, PlayerSetup } from '@iron/shared';
import { audio } from '../game/audio';
import { useStore } from '../game/store';
import { connect, net } from '../net/socket';
import { GameScreen } from './GameScreen';
import { HowToPlay } from './screens/HowToPlay';
import { Lobby } from './screens/Lobby';
import { MainMenu } from './screens/MainMenu';
import { MultiplayerMenu } from './screens/MultiplayerMenu';
import { SettingsScreen } from './screens/SettingsScreen';
import { SkirmishSetup } from './screens/SkirmishSetup';

export type Screen = 'menu' | 'skirmish' | 'multiplayer' | 'lobby' | 'settings' | 'howto' | 'game';
export type GameConfig = { kind: 'local'; mapId: string; players: PlayerSetup[] } | { kind: 'remote'; info: GameStartInfo };

export function App() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('room');
  // ?demo=1 starts an AI-vs-AI match to spectate (useful for showcasing and visual testing).
  const demo = params.get('demo');
  const [screen, setScreen] = useState<Screen>(inviteCode ? 'multiplayer' : demo ? 'game' : 'menu');
  const [config, setConfig] = useState<GameConfig | null>(
    demo
      ? {
          kind: 'local',
          mapId: params.get('map') ?? 'twin-rivers',
          players: [
            { name: 'Coalition AI', faction: 'cdc', color: '#3d8bff', team: 1, isAI: true, difficulty: 'hard' },
            { name: 'Directorate AI', faction: 'esd', color: '#e8423a', team: 2, isAI: true, difficulty: 'hard' },
          ],
        }
      : null,
  );
  const [prevScreen, setPrevScreen] = useState<Screen>('menu');
  const netState = useStore(net);

  // Online match started by the server (or rejoined after a reload).
  useEffect(() => {
    if (netState.game && (screen !== 'game' || config?.kind !== 'remote' || config.info !== netState.game)) {
      setConfig({ kind: 'remote', info: netState.game });
      setScreen('game');
    }
  }, [netState.game]);

  useEffect(() => {
    if (netState.lobby && (screen === 'multiplayer' || screen === 'menu') && !netState.game) setScreen('lobby');
  }, [netState.lobby]);

  // Resume a session after reload if this tab was in a room.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ironfront.token')) connect().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }, []);

  const go = (s: Screen) => {
    audio.unlock();
    audio.play('click');
    setPrevScreen(screen);
    setScreen(s);
  };

  switch (screen) {
    case 'menu':
      return <MainMenu go={go} />;
    case 'skirmish':
      return <SkirmishSetup back={() => go('menu')} start={(c) => { setConfig(c); go('game'); }} />;
    case 'multiplayer':
      return <MultiplayerMenu back={() => go('menu')} inviteCode={inviteCode} onJoined={() => go('lobby')} />;
    case 'lobby':
      return <Lobby back={() => go('multiplayer')} />;
    case 'settings':
      return <SettingsScreen back={() => go(prevScreen === 'settings' ? 'menu' : prevScreen === 'game' ? 'menu' : prevScreen)} />;
    case 'howto':
      return <HowToPlay back={() => go('menu')} />;
    case 'game':
      if (!config) return <MainMenu go={go} />;
      return (
        <GameScreen
          key={config.kind === 'remote' ? `r${config.info.seed}` : 'local'}
          config={config}
          exit={(to) => {
            if (config.kind === 'remote') net.patch({ game: null });
            setConfig(null);
            setScreen(to);
          }}
          restart={() => {
            if (config.kind === 'local') {
              setConfig({ ...config });
              setScreen('menu');
              setTimeout(() => setScreen('game'), 0);
            }
          }}
        />
      );
  }
}
