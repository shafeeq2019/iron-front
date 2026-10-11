import { useSyncExternalStore } from 'react';
import { audio } from '../../game/audio';
import { getSettings, onSettings, updateSettings } from '../../game/settings';
import { Screen } from '../common';

const sub = (fn: () => void) => onSettings(fn);

export function SettingsPanel() {
  const s = useSyncExternalStore(sub, getSettings);
  return (
    <div className="settings">
      <label className="field">
        <span>Music volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.musicVolume} onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Sound effects volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.sfxVolume} onChange={(e) => { updateSettings({ sfxVolume: Number(e.target.value) }); audio.unlock(); audio.play('click'); }} />
      </label>
      <label className="field check">
        <input type="checkbox" checked={s.announcer} onChange={(e) => updateSettings({ announcer: e.target.checked })} />
        <span>Spoken announcer (uses your browser's speech voice)</span>
      </label>
      <label className="field check">
        <input type="checkbox" checked={s.edgeScroll} onChange={(e) => updateSettings({ edgeScroll: e.target.checked })} />
        <span>Edge scrolling (desktop)</span>
      </label>
      <label className="field">
        <span>Scroll speed</span>
        <input type="range" min={0.4} max={2} step={0.1} value={s.scrollSpeed} onChange={(e) => updateSettings({ scrollSpeed: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Graphics quality</span>
        <select value={s.quality} onChange={(e) => updateSettings({ quality: e.target.value as 'low' | 'high' })}>
          <option value="high">High (sharper, more particles)</option>
          <option value="low">Low (faster on phones)</option>
        </select>
      </label>
      <label className="field check">
        <input type="checkbox" checked={s.showFps} onChange={(e) => updateSettings({ showFps: e.target.checked })} />
        <span>Show performance overlay</span>
      </label>
    </div>
  );
}

export function SettingsScreen({ back }: { back: () => void }) {
  return (
    <Screen title="Settings" back={back}>
      <SettingsPanel />
    </Screen>
  );
}
