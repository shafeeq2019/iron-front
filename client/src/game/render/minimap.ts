import { TILE, type BuildingDef } from '@iron/shared';
import type { Camera } from '../camera';
import type { ClientWorld } from '../world';

/** Radar minimap: terrain, ore, fog, units, structures and the camera frame. */
export class Minimap {
  private base: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private fogVersion = -1;
  private oreVersion = -1;
  private oreLayer: HTMLCanvasElement;

  constructor(private world: ClientWorld, terrainImage: HTMLCanvasElement) {
    this.base = terrainImage;
    this.fog = document.createElement('canvas');
    this.fog.width = world.w;
    this.fog.height = world.h;
    this.fogCtx = this.fog.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(world.w, world.h);
    this.oreLayer = document.createElement('canvas');
    this.oreLayer.width = world.w;
    this.oreLayer.height = world.h;
  }

  draw(canvas: HTMLCanvasElement, cam: Camera) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = this.world;
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / w.w, H / w.h);
    const ox = (W - w.w * scale) / 2, oy = (H - w.h * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050705';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, ox, oy, w.w * scale, w.h * scale);
    if (this.oreVersion !== w.oreVersion || this.fogVersion !== w.fogVersion) {
      this.oreVersion = w.oreVersion;
      const octx = this.oreLayer.getContext('2d')!;
      const img = octx.createImageData(w.w, w.h);
      for (let i = 0; i < w.ore.length; i++) {
        if (w.ore[i] > 0 && w.explored[i]) { img.data[i * 4] = 232; img.data[i * 4 + 1] = 170; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 220; }
      }
      octx.putImageData(img, 0, 0);
    }
    ctx.drawImage(this.oreLayer, ox, oy, w.w * scale, w.h * scale);
    const s = scale / TILE;
    for (const g of w.ghosts) {
      ctx.fillStyle = w.playerColor(g.owner);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(ox + g.tx * scale, oy + g.ty * scale, 2 * scale, 2 * scale);
      ctx.globalAlpha = 1;
    }
    for (const e of w.ents.values()) {
      ctx.fillStyle = w.playerColor(e.owner);
      if (e.isBuilding) {
        const d = e.def as BuildingDef;
        ctx.fillRect(ox + e.tx * scale, oy + e.ty * scale, Math.max(2, d.w * scale), Math.max(2, d.h * scale));
      } else {
        const r = Math.max(1.5, scale * 0.9);
        ctx.fillRect(ox + e.x * s - r / 2, oy + e.y * s - r / 2, r, r);
      }
    }
    if (this.fogVersion !== w.fogVersion) {
      this.fogVersion = w.fogVersion;
      const d = this.fogImg.data;
      for (let i = 0; i < w.visible.length; i++) d[i * 4 + 3] = w.visible[i] ? 0 : w.explored[i] ? 110 : 255;
      this.fogCtx.putImageData(this.fogImg, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, ox, oy, w.w * scale, w.h * scale);
    ctx.strokeStyle = '#e8f0e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + cam.x * s + 0.5, oy + cam.y * s + 0.5, cam.viewW * s, cam.viewH * s);
  }

  /** Converts a click on the minimap canvas (CSS px) to world coordinates. */
  toWorld(canvas: HTMLCanvasElement, cssX: number, cssY: number) {
    const w = this.world;
    const W = canvas.width, H = canvas.height;
    const k = W / canvas.clientWidth;
    const scale = Math.min(W / w.w, H / w.h);
    const ox = (W - w.w * scale) / 2, oy = (H - w.h * scale) / 2;
    return { x: ((cssX * k - ox) / scale) * TILE, y: ((cssY * k - oy) / scale) * TILE };
  }
}
