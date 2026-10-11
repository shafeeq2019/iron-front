import { isKnownType } from '../data/defs';
import type { Command } from './types';

const CATS = new Set(['building', 'defense', 'infantry', 'vehicle']);
const MAX_IDS = 250;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => num(v) && Number.isInteger(v);

function ids(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_IDS) return null;
  for (const x of v) if (!int(x) || x <= 0) return null;
  return v as number[];
}

/**
 * Structural validation of an untrusted command (e.g. from the network).
 * Returns a clean copy with only known fields, or null when malformed.
 * Game rules (ownership, costs, placement...) are enforced by Game.issue().
 */
export function sanitizeCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.t) {
    case 'move':
    case 'attackMove':
    case 'harvest': {
      const i = ids(c.ids);
      if (!i || !num(c.x) || !num(c.y)) return null;
      return { t: c.t, ids: i, x: c.x, y: c.y };
    }
    case 'attack':
    case 'enter': {
      const i = ids(c.ids);
      if (!i || !int(c.target)) return null;
      return { t: c.t, ids: i, target: c.target };
    }
    case 'stop':
    case 'deploy': {
      const i = ids(c.ids);
      if (!i) return null;
      return { t: c.t, ids: i };
    }
    case 'build':
    case 'cancel': {
      if (typeof c.cat !== 'string' || !CATS.has(c.cat) || !isKnownType(c.type)) return null;
      return { t: c.t, cat: c.cat as 'building', type: c.type };
    }
    case 'place': {
      if (!isKnownType(c.type) || !int(c.tx) || !int(c.ty)) return null;
      return { t: 'place', type: c.type, tx: c.tx, ty: c.ty };
    }
    case 'sell':
    case 'repair': {
      if (!int(c.id)) return null;
      return { t: c.t, id: c.id };
    }
    case 'rally': {
      if (!int(c.id) || !num(c.x) || !num(c.y)) return null;
      return { t: 'rally', id: c.id, x: c.x, y: c.y };
    }
    case 'sweep': {
      if (!num(c.x) || !num(c.y)) return null;
      return { t: 'sweep', x: c.x, y: c.y };
    }
    case 'surrender':
      return { t: 'surrender' };
  }
  return null;
}
