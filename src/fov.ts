// Recursive shadowcasting field of view.
const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

export function computeFov(
  w: number,
  h: number,
  opaque: (x: number, y: number) => boolean,
  ox: number,
  oy: number,
  radius: number,
  out: Uint8Array,
): void {
  out[oy * w + ox] = 1;
  const r2 = radius * radius;
  const cast = (row: number, start: number, end: number, xx: number, xy: number, yx: number, yy: number): void => {
    if (start < end) return;
    let newStart = 0;
    for (let j = row; j <= radius; j++) {
      let dx = -j - 1;
      const dy = -j;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const X = ox + dx * xx + dy * xy;
        const Y = oy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;
        const inside = X >= 0 && Y >= 0 && X < w && Y < h;
        if (inside && dx * dx + dy * dy < r2) out[Y * w + X] = 1;
        const op = !inside || opaque(X, Y);
        if (blocked) {
          if (op) {
            newStart = rSlope;
            continue;
          }
          blocked = false;
          start = newStart;
        } else if (op && j < radius) {
          blocked = true;
          cast(j + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  };
  for (let o = 0; o < 8; o++) cast(1, 1.0, 0.0, MULT[0][o], MULT[1][o], MULT[2][o], MULT[3][o]);
}
