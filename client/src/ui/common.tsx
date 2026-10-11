import { useEffect, useRef, type ReactNode } from 'react';
import { FACTIONS, PLAYER_COLORS, getMap, type FactionId } from '@iron/shared';
import { TerrainRenderer } from '../game/render/terrain';
import { iconFor } from '../game/render/sprites';

export function Screen({ title, back, children, wide }: { title: string; back?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="screen">
      <div className="screen-bg" />
      <div className={`panel screen-panel ${wide ? 'wide' : ''}`}>
        <div className="panel-head">
          {back && <button className="btn ghost small" onClick={back} aria-label="Back">◀ Back</button>}
          <h2>{title}</h2>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

const previewCache = new Map<string, string>();
export function MapPreview({ mapId, size = 160, highlight }: { mapId: string; size?: number; highlight?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const m = getMap(mapId);
    const c = ref.current;
    if (!m || !c) return;
    const ctx = c.getContext('2d')!;
    let url = previewCache.get(mapId);
    const draw = (img: CanvasImageSource) => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / m.width, c.height / m.height);
      const ox = (c.width - m.width * s) / 2, oy = (c.height - m.height * s) / 2;
      ctx.drawImage(img, ox, oy, m.width * s, m.height * s);
      ctx.fillStyle = 'rgba(232,170,40,0.9)';
      for (let i = 0; i < m.ore.length; i++) if (m.ore[i] > 0) ctx.fillRect(ox + (i % m.width) * s, oy + Math.floor(i / m.width) * s, s, s);
      m.starts.forEach((st, i) => {
        ctx.fillStyle = i === highlight ? '#fff' : PLAYER_COLORS[i];
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ox + st.x * s, oy + st.y * s, Math.max(4, s * 3), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillStyle = '#9ad';
      for (const d of m.derricks) ctx.fillRect(ox + d.x * s, oy + d.y * s, s * 2, s * 2);
    };
    if (!url) {
      const img = new TerrainRenderer(m).minimapImage();
      url = img.toDataURL();
      previewCache.set(mapId, url);
    }
    const im = new Image();
    im.onload = () => draw(im);
    im.src = url;
  }, [mapId, highlight]);
  return <canvas ref={ref} width={size} height={size} className="map-preview" />;
}

export function FactionPicker({ value, onChange, color }: { value: FactionId; onChange: (f: FactionId) => void; color: string }) {
  return (
    <div className="faction-grid">
      {(Object.keys(FACTIONS) as FactionId[]).map((f) => {
        const fd = FACTIONS[f];
        const unit = f === 'cdc' ? 'heavytank' : 'mauler';
        return (
          <button key={f} className={`faction-card ${value === f ? 'active' : ''} ${f}`} onClick={() => onChange(f)}>
            <img src={iconFor(unit, color, f)} alt="" />
            <div>
              <div className="faction-name">{fd.name}</div>
              <div className="faction-tag">{fd.doctrine} — {fd.tagline}</div>
              <ul>{fd.traits.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ColorPicker({ value, onChange, taken = [] }: { value: string; onChange: (c: string) => void; taken?: string[] }) {
  return (
    <div className="color-row">
      {PLAYER_COLORS.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'active' : ''}`}
          style={{ background: c }}
          disabled={taken.includes(c) && value !== c}
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
        />
      ))}
    </div>
  );
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
