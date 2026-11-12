// Renders every sprite to docs/sprite-sheet.png for review:  node tools/sprite-sheet.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { allArt } from '../src/web/art.ts';

const art = allArt();
const items = Object.entries(art).map(([name, p]) => ({ name, w: p.w, h: p.h, d: Array.from(p.data) }));
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#141210">
<canvas id="c"></canvas><script>
const items=${JSON.stringify(items)};
const S=4, CELL=24*S+16, COLS=10;
const cv=document.getElementById('c');cv.width=COLS*CELL;cv.height=Math.ceil(items.length/COLS)*(CELL+14)+8;
const x=cv.getContext('2d');x.fillStyle='#141210';x.fillRect(0,0,cv.width,cv.height);
x.font='11px Consolas';x.fillStyle='#a8a090';
items.forEach((it,i)=>{const cx=(i%COLS)*CELL+8, cy=Math.floor(i/COLS)*(CELL+14)+8;
 x.fillStyle='#1e1a16';x.fillRect(cx,cy,24*S,24*S);
 it.d.forEach((c,j)=>{if(c<0)return;x.fillStyle='#'+c.toString(16).padStart(6,'0');x.fillRect(cx+(j%it.w)*S,cy+Math.floor(j/it.w)*S,S,S);});
 x.fillStyle='#a8a090';x.fillText(it.name,cx,cy+24*S+11);});
</script>`;
const out = path.resolve('docs');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'sprite-sheet.html');
fs.writeFileSync(file, html);
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (browser) {
  const rows = Math.ceil(items.length / 10);
  spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${path.join(out, 'sprite-sheet.png')}`, `--window-size=${10 * (24 * 4 + 16)},${rows * (24 * 4 + 30) + 16}`, 'file:///' + file.replace(/\\/g, '/')], { stdio: 'ignore' });
  fs.unlinkSync(file);
  console.log('wrote docs/sprite-sheet.png');
}
