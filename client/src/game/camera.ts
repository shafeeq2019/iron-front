/** Camera pitch (radians above the horizon) of the 3D battlefield view. */
export const CAMERA_PITCH = (48 * Math.PI) / 180;

/**
 * RTS camera. The ground (x, y) maps linearly to the screen: x scaled by zoom,
 * y scaled by zoom * tilt, where tilt = sin(pitch) for the angled 3D view
 * (1 for a straight top-down view). Objects raised by height h appear shifted
 * up by h * cos(pitch) * zoom.
 */
export class Camera {
  /** World ground coordinate at the top-left of the viewport. */
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 2.4;
  /** Viewport size in CSS pixels. */
  vw = 800;
  vh = 600;
  /** Space reserved by UI on the right/bottom/top (CSS px) so the map edge can be scrolled into view. */
  padRight = 0;
  padBottom = 0;
  padTop = 0;
  /** Vertical ground foreshortening (sin of pitch). */
  tilt = 1;
  /** Screen shift per unit of height (cos of pitch). */
  lift = 0;

  constructor(public worldW: number, public worldH: number) {}

  setPitch(pitch: number) {
    this.tilt = Math.sin(pitch);
    this.lift = Math.cos(pitch);
  }

  worldToScreen(wx: number, wy: number, h = 0) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom * this.tilt - h * this.lift * this.zoom };
  }
  screenToWorld(sx: number, sy: number) {
    return { x: sx / this.zoom + this.x, y: sy / (this.zoom * this.tilt) + this.y };
  }
  get viewW() {
    return this.vw / this.zoom;
  }
  get viewH() {
    return this.vh / (this.zoom * this.tilt);
  }
  clamp() {
    const zy = this.zoom * this.tilt;
    const minX = (-this.vw * 0.1) / this.zoom, minY = -this.padTop / zy - 40;
    const maxX = this.worldW - (this.vw - this.padRight) / this.zoom + (this.vw * 0.05) / this.zoom;
    const maxY = this.worldH - (this.vh - this.padBottom) / zy + 20;
    this.x = Math.min(Math.max(this.x, minX), Math.max(minX, maxX));
    this.y = Math.min(Math.max(this.y, minY), Math.max(minY, maxY));
  }
  centerOn(wx: number, wy: number) {
    this.x = wx - (this.vw - this.padRight) / 2 / this.zoom;
    this.y = wy - (this.vh - this.padBottom + this.padTop) / 2 / (this.zoom * this.tilt);
    this.clamp();
  }
  /** Zoom keeping the world point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = before.x - sx / this.zoom;
    this.y = before.y - sy / (this.zoom * this.tilt);
    this.clamp();
  }
  pan(dxScreen: number, dyScreen: number) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / (this.zoom * this.tilt);
    this.clamp();
  }
}
