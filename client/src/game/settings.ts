export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  announcer: boolean;
  edgeScroll: boolean;
  scrollSpeed: number;
  showFps: boolean;
  quality: 'low' | 'high';
  playerName: string;
}

const KEY = 'ironfront.settings.v1';
const isTouch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

const DEFAULTS: Settings = {
  musicVolume: 0.35,
  sfxVolume: 0.7,
  announcer: true,
  edgeScroll: !isTouch,
  scrollSpeed: 1,
  showFps: false,
  quality: isTouch ? 'low' : 'high',
  playerName: '',
};

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const IS_TOUCH = isTouch;
