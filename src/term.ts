// Double-buffered truecolor terminal screen. Only changed cells are written each frame.

function c255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
export function rgb(r: number, g: number, b: number): number {
  return (c255(r) << 16) | (c255(g) << 8) | c255(b);
}
export function scale(c: number, f: number): number {
  return rgb(((c >> 16) & 255) * f, ((c >> 8) & 255) * f, (c & 255) * f);
}
export function mix(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export class Screen {
  w = 0;
  h = 0;
  ch: string[] = [];
  fg: Int32Array = new Int32Array(0);
  bg: Int32Array = new Int32Array(0);
  pch: string[] = [];
  pfg: Int32Array = new Int32Array(0);
  pbg: Int32Array = new Int32Array(0);
  full = true;

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const n = w * h;
    this.ch = new Array(n).fill(' ');
    this.fg = new Int32Array(n);
    this.bg = new Int32Array(n);
    this.pch = new Array(n).fill('');
    this.pfg = new Int32Array(n).fill(-1);
    this.pbg = new Int32Array(n).fill(-1);
    this.full = true;
  }

  clear(bg: number): void {
    this.ch.fill(' ');
    this.fg.fill(0xffffff);
    this.bg.fill(bg);
  }

  put(x: number, y: number, c: string, fg: number, bg?: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.ch[i] = c;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
  }

  getBg(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.bg[y * this.w + x];
  }

  text(x: number, y: number, s: string, fg: number, bg?: number): number {
    let i = 0;
    for (const c of s) {
      this.put(x + i, y, c, fg, bg);
      i++;
    }
    return i;
  }

  fill(x: number, y: number, w: number, h: number, bg: number, c = ' ', fg = 0xffffff): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, c, fg, bg);
  }

  flush(): string {
    let out = '';
    let cx = -1, cy = -1, cf = -1, cb = -1;
    const w = this.w;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = this.ch[i], f = this.fg[i], b = this.bg[i];
        if (!this.full && c === this.pch[i] && f === this.pfg[i] && b === this.pbg[i]) continue;
        if (cx !== x || cy !== y) out += `\x1b[${y + 1};${x + 1}H`;
        if (f !== cf) {
          out += `\x1b[38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255}m`;
          cf = f;
        }
        if (b !== cb) {
          out += `\x1b[48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}m`;
          cb = b;
        }
        out += c;
        cx = x + 1;
        cy = y;
        this.pch[i] = c;
        this.pfg[i] = f;
        this.pbg[i] = b;
      }
    }
    this.full = false;
    return out;
  }

  /** Plain-text dump (for tests / snapshots). */
  dump(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) rows.push(this.ch.slice(y * this.w, (y + 1) * this.w).join(''));
    return rows.join('\n');
  }
}
