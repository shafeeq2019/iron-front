export type RGB = [number, number, number];

const cache = new Map<string, RGB>();
export function hexToRgb(hex: string): RGB {
  let c = cache.get(hex);
  if (c) return c;
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  c = [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  cache.set(hex, c);
  return c;
}

export function rgb(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

/** Multiply brightness (f < 1 darker, f > 1 lighter towards white). */
export function shade(c: RGB, f: number): RGB {
  if (f <= 1) return [c[0] * f, c[1] * f, c[2] * f];
  const t = f - 1;
  return [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function S(hex: string, f = 1, a = 1): string {
  return rgb(shade(hexToRgb(hex), f), a);
}
