import { TILE, type BuildingDef } from '@iron/shared';
import type { Camera } from '../camera';
import type { ClientWorld } from '../world';

/**
 * Radar minimap: terrain, ore, fog, units, structures and the camera view.
 * The map is rotated by the camera yaw (a diamond in isometric view) so it
 * matches what is on screen.
 */
export class Minimap {
  private fog: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private fogVersion = -1;
  private oreVersion = -1;
  private oreLayer: HTMLCanvasElement;

  constructor(private world: ClientWorld, private base: HTMLCanvasElement) {
    this.fog = document.createElement('canvas');
    this.fog.width = world.w;
    this.fog.height = world.h;
    this.fogCtx = this.fog.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(world.w, world.h);
    this.oreLayer = document.createElement('canvas');
    this.oreLayer.width = world.w;
    this.oreLayer.height = world.h;
  }

  /** Canvas-pixel transform for a given camera yaw. */
  private layout(canvas: HTMLCanvasElement, yaw: number) {
    const w = this.world;
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const spanX = w.w * c + w.h * s, spanY = w.w * s + w.h * c;
    const scale = Math.min(canvas.width / spanX, canvas.height / spanY) * 0.98;
    return { scale, cx: canvas.width / 2, cy: canvas.height / 2 };
  }

  draw(canvas: HTMLCanvasElement, cam: Camera) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = this.world;
    const { scale, cx, cy } = this.layout(canvas, cam.yaw);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050705';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Map-space (tiles) transform.
    ctx.translate(cx, cy);
    ctx.rotate(cam.yaw);
    ctx.scale(scale, scale);
    ctx.translate(-w.w / 2, -w.h / 2);
    ctx.imageSmoothingEnabled = cam.yaw !== 0;
    ctx.drawImage(this.base, 0, 0, w.w, w.h);
    if (this.oreVersion !== w.oreVersion || this.fogVersion !== w.fogVersion) {
      this.oreVersion = w.oreVersion;
      const octx = this.oreLayer.getContext('2d')!;
      const img = octx.createImageData(w.w, w.h);
      for (let i = 0; i < w.ore.length; i++) {
        if (w.ore[i] > 0 && w.explored[i]) { img.data[i * 4] = 232; img.data[i * 4 + 1] = 170; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 220; }
      }
      octx.putImageData(img, 0, 0);
    }
    ctx.drawImage(this.oreLayer, 0, 0, w.w, w.h);
    const px = 1.6 / scale;
    for (const g of w.ghosts) {
      ctx.fillStyle = w.playerColor(g.owner);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(g.tx, g.ty, 2, 2);
      ctx.globalAlpha = 1;
    }
    for (const e of w.ents.values()) {
      ctx.fillStyle = w.playerColor(e.owner);
      if (e.isBuilding) {
        const d = e.def as BuildingDef;
        ctx.fillRect(e.tx, e.ty, Math.max(px * 1.5, d.w), Math.max(px * 1.5, d.h));
      } else {
        const r = Math.max(px * 1.6, 0.9);
        ctx.fillRect(e.x / TILE - r / 2, e.y / TILE - r / 2, r, r);
      }
    }
    if (this.fogVersion !== w.fogVersion) {
      this.fogVersion = w.fogVersion;
      const d = this.fogImg.data;
      for (let i = 0; i < w.visible.length; i++) d[i * 4 + 3] = w.visible[i] ? 0 : w.explored[i] ? 110 : 255;
      this.fogCtx.putImageData(this.fogImg, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, w.w, w.h);
    // Camera view footprint.
    const corners = cam.corners();
    ctx.strokeStyle = '#e8f0e0';
    ctx.lineWidth = 1.2 / scale;
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x / TILE, p.y / TILE) : ctx.moveTo(p.x / TILE, p.y / TILE)));
    ctx.closePath();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Converts a click on the minimap canvas (CSS px) to world coordinates. */
  toWorld(canvas: HTMLCanvasElement, cssX: number, cssY: number, yaw = 0) {
    const w = this.world;
    const k = canvas.width / canvas.clientWidth;
    const { scale, cx, cy } = this.layout(canvas, yaw);
    const ux = (cssX * k - cx) / scale, uy = (cssY * k - cy) / scale;
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    const tx = ux * c - uy * s + w.w / 2, ty = ux * s + uy * c + w.h / 2;
    return { x: tx * TILE, y: ty * TILE };
  }
}
