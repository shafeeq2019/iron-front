/** Camera pitch (radians above the horizon) of the 3D battlefield view (RA2-like dimetric). */
export const CAMERA_PITCH = (34 * Math.PI) / 180;
/** Camera yaw: 45° gives the classic isometric diamond view. */
export const CAMERA_YAW = Math.PI / 4;

/**
 * RTS camera with an exact affine mapping between the ground plane and the
 * screen: the ground is rotated by `yaw`, its depth axis foreshortened by
 * `tilt` (= sin pitch) and scaled by `zoom`. A point raised by height h moves
 * up the screen by h * lift * zoom (lift = cos pitch). With yaw 0 and tilt 1
 * this is a plain top-down view (used by the 2D fallback renderer).
 */
export class Camera {
  /** Ground point at the centre of the viewport. */
  cx = 0;
  cy = 0;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 2.6;
  /** Viewport size in CSS pixels. */
  vw = 800;
  vh = 600;
  /** Space reserved by UI on the right/bottom/top (CSS px). */
  padRight = 0;
  padBottom = 0;
  padTop = 0;
  tilt = 1;
  lift = 0;
  yaw = 0;
  private cos = 1;
  private sin = 0;

  constructor(public worldW: number, public worldH: number) {
    this.cx = worldW / 2;
    this.cy = worldH / 2;
  }

  setPitch(pitch: number) {
    this.tilt = Math.sin(pitch);
    this.lift = Math.cos(pitch);
  }
  setYaw(yaw: number) {
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  worldToScreen(wx: number, wy: number, h = 0) {
    const dx = wx - this.cx, dy = wy - this.cy;
    const rx = dx * this.cos - dy * this.sin, ry = dx * this.sin + dy * this.cos;
    return { x: this.vw / 2 + rx * this.zoom, y: this.vh / 2 + ry * this.zoom * this.tilt - h * this.lift * this.zoom };
  }
  /** Ground point under a screen position (optionally for a surface at height h). */
  screenToWorld(sx: number, sy: number, h = 0) {
    const g = this.screenDeltaToGround(sx - this.vw / 2, sy - this.vh / 2 + h * this.lift * this.zoom);
    return { x: this.cx + g.x, y: this.cy + g.y };
  }
  private screenDeltaToGround(dsx: number, dsy: number) {
    const rx = dsx / this.zoom, ry = dsy / (this.zoom * this.tilt);
    return { x: rx * this.cos + ry * this.sin, y: -rx * this.sin + ry * this.cos };
  }

  /** Ground-plane corners of the viewport (TL, TR, BR, BL). */
  corners() {
    return [this.screenToWorld(0, 0), this.screenToWorld(this.vw, 0), this.screenToWorld(this.vw, this.vh), this.screenToWorld(0, this.vh)];
  }
  /** Axis-aligned ground bounds of the viewport. */
  bounds(margin = 0) {
    const c = this.corners();
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    return { x0: Math.min(...xs) - margin, y0: Math.min(...ys) - margin, x1: Math.max(...xs) + margin, y1: Math.max(...ys) + margin };
  }
  onScreen(wx: number, wy: number, marginPx = 64, h = 0) {
    const p = this.worldToScreen(wx, wy, h);
    return p.x > -marginPx && p.y > -marginPx && p.x < this.vw + marginPx && p.y < this.vh + marginPx;
  }
  /** Top-left of the ground bounds (meaningful for the top-down 2D renderer). */
  get x() {
    return this.cx - this.vw / (2 * this.zoom);
  }
  get y() {
    return this.cy - this.vh / (2 * this.zoom * this.tilt);
  }
  get viewW() {
    const b = this.bounds();
    return b.x1 - b.x0;
  }
  get viewH() {
    const b = this.bounds();
    return b.y1 - b.y0;
  }

  clamp() {
    const m = 64;
    this.cx = Math.min(Math.max(this.cx, -m), this.worldW + m);
    this.cy = Math.min(Math.max(this.cy, -m), this.worldH + m);
  }
  /** Centres a ground point in the part of the screen not covered by HUD panels. */
  centerOn(wx: number, wy: number) {
    const ux = (this.vw - this.padRight) / 2 - this.vw / 2;
    const uy = (this.vh - this.padBottom + this.padTop) / 2 - this.vh / 2;
    const g = this.screenDeltaToGround(ux, uy);
    this.cx = wx - g.x;
    this.cy = wy - g.y;
    this.clamp();
  }
  /** Zoom keeping the ground point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp();
  }
  pan(dxScreen: number, dyScreen: number) {
    const g = this.screenDeltaToGround(dxScreen, dyScreen);
    this.cx += g.x;
    this.cy += g.y;
    this.clamp();
  }
}
