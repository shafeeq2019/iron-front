export class Camera {
  /** World coordinate at the top-left of the viewport. */
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 2;
  /** Viewport size in CSS pixels. */
  vw = 800;
  vh = 600;
  /** Extra space reserved by UI on the right/bottom (CSS px) so the map edge can be scrolled into view. */
  padRight = 0;
  padBottom = 0;
  padTop = 0;

  constructor(public worldW: number, public worldH: number) {}

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }
  screenToWorld(sx: number, sy: number) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }
  get viewW() {
    return this.vw / this.zoom;
  }
  get viewH() {
    return this.vh / this.zoom;
  }
  clamp() {
    const minX = -this.vw * 0.1 / this.zoom, minY = -this.padTop / this.zoom;
    const maxX = this.worldW - (this.vw - this.padRight) / this.zoom + this.vw * 0.05 / this.zoom;
    const maxY = this.worldH - (this.vh - this.padBottom) / this.zoom;
    this.x = Math.min(Math.max(this.x, minX), Math.max(minX, maxX));
    this.y = Math.min(Math.max(this.y, minY), Math.max(minY, maxY));
  }
  centerOn(wx: number, wy: number) {
    this.x = wx - (this.vw - this.padRight) / 2 / this.zoom;
    this.y = wy - (this.vh - this.padBottom) / 2 / this.zoom;
    this.clamp();
  }
  /** Zoom keeping the world point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = before.x - sx / this.zoom;
    this.y = before.y - sy / this.zoom;
    this.clamp();
  }
  pan(dxScreen: number, dyScreen: number) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }
}
