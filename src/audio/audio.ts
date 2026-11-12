// Audio playback. Sounds are synthesized once into a WAV cache, then played by a platform backend:
//  - Windows: one persistent PowerShell process driving winmm MCI (polyphonic, looping music)
//  - macOS:   afplay      - Linux: paplay / aplay
// Every failure path degrades to silence; audio must never crash the game.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { SFX, MUSIC } from './sounds.ts';
import { toWav } from './synth.ts';

const VERSION = 'v1';
const CACHE = path.join(os.homedir(), '.ashen-deep', 'audio', VERSION);

// how many overlapping copies of each effect may play at once
const POLY: Record<string, number> = { swing: 3, hit: 3, warn: 3, ashes: 2, kill: 2, hurt: 2, arrow: 2, crit: 2, rune: 2, menu: 2 };
// per-effect volume (0-1000, MCI scale)
const VOL: Record<string, number> = { warn: 650, ashes: 700, menu: 700 };
const MUSIC_VOL = 520;

export type AudioMode = 0 | 1 | 2; // 0 all on, 1 effects only, 2 muted
export const AUDIO_MODE_NAMES = ['music + sound', 'sound only', 'muted'];

interface Backend {
  play(id: string): void;
  music(id: string | null): void;
  close(): void;
}

/** Render any missing WAVs. Returns false if the cache could not be written. */
export function ensureCache(onProgress?: (msg: string) => void): boolean {
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const jobs: [string, () => Float32Array][] = [
      ...Object.entries(SFX).map(([k, g]) => [`sfx_${k}`, g] as [string, () => Float32Array]),
      ...Object.entries(MUSIC).map(([k, g]) => [`mus_${k}`, g] as [string, () => Float32Array]),
    ];
    const missing = jobs.filter(([name]) => !fs.existsSync(path.join(CACHE, `${name}.wav`)));
    if (missing.length && onProgress) onProgress(`Forging the sounds of the deep (${missing.length} to make, first run only)...`);
    for (const [name, gen] of missing) {
      const tmp = path.join(CACHE, `${name}.tmp`);
      fs.writeFileSync(tmp, toWav(gen()));
      fs.renameSync(tmp, path.join(CACHE, `${name}.wav`));
    }
    return true;
  } catch {
    return false;
  }
}

export function wavPath(name: string): string {
  return path.join(CACHE, `${name}.wav`);
}

// ------------------------------------------------------------------ Windows (MCI via PowerShell)
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class AshenMci {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
  public static extern int mciSendStringW(string cmd, StringBuilder ret, int len, IntPtr cb);
}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  [void][AshenMci]::mciSendStringW($line, $null, 0, [IntPtr]::Zero)
}
[void][AshenMci]::mciSendStringW('close all', $null, 0, [IntPtr]::Zero)
`;

class WinBackend implements Backend {
  proc: ChildProcess;
  rr: Record<string, number> = {};
  opened = new Set<string>();
  current: string | null = null;
  dead = false;

  constructor() {
    const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    this.proc.on('error', () => (this.dead = true));
    this.proc.on('exit', () => (this.dead = true));
    this.proc.stdin?.on('error', () => (this.dead = true));
    // preload everything so playback has no latency
    for (const id of Object.keys(SFX)) {
      for (let k = 0; k < (POLY[id] ?? 1); k++) this.open(`sfx_${id}`, `s_${id}_${k}`, VOL[id] ?? 1000);
    }
    for (const id of Object.keys(MUSIC)) this.open(`mus_${id}`, `m_${id}`, MUSIC_VOL);
  }

  send(cmd: string): void {
    if (this.dead || !this.proc.stdin?.writable) return;
    this.proc.stdin.write(cmd + '\n');
  }

  open(file: string, alias: string, vol: number): void {
    this.send(`open "${wavPath(file)}" type mpegvideo alias ${alias}`);
    this.send(`setaudio ${alias} volume to ${vol}`);
    this.opened.add(alias);
  }

  play(id: string): void {
    const n = POLY[id] ?? 1;
    const k = (this.rr[id] = ((this.rr[id] ?? -1) + 1) % n);
    this.send(`play s_${id}_${k} from 0`);
  }

  music(id: string | null): void {
    if (id === this.current) return;
    if (this.current) this.send(`stop m_${this.current}`);
    this.current = id;
    if (id) this.send(`play m_${id} from 0 repeat`);
  }

  close(): void {
    this.send('close all');
    try {
      this.proc.stdin?.end();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
    }, 300).unref();
  }
}

// ------------------------------------------------------------------ macOS / Linux (spawn per sound)
class SpawnBackend implements Backend {
  cmd: string;
  args: (file: string, music: boolean) => string[];
  live = 0;
  musicProc: ChildProcess | null = null;
  current: string | null = null;

  constructor(cmd: string, args: (file: string, music: boolean) => string[]) {
    this.cmd = cmd;
    this.args = args;
  }

  spawnFile(file: string, music: boolean): ChildProcess | null {
    try {
      const p = spawn(this.cmd, this.args(file, music), { stdio: 'ignore' });
      p.on('error', () => {});
      return p;
    } catch {
      return null;
    }
  }

  play(id: string): void {
    if (this.live >= 8) return;
    const p = this.spawnFile(wavPath(`sfx_${id}`), false);
    if (!p) return;
    this.live++;
    p.on('exit', () => this.live--);
  }

  music(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    const old = this.musicProc;
    this.musicProc = null;
    old?.kill();
    if (id) this.loop(id);
  }

  loop(id: string): void {
    const p = this.spawnFile(wavPath(`mus_${id}`), true);
    if (!p) return;
    this.musicProc = p;
    p.on('exit', () => {
      if (this.current === id && this.musicProc === p) this.loop(id);
    });
  }

  close(): void {
    this.current = null;
    this.musicProc?.kill();
  }
}

function has(cmd: string): boolean {
  try {
    return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ public
export class Audio {
  backend: Backend | null = null;
  mode: AudioMode = 0;
  wantMusic: string | null = null;
  last: Record<string, number> = {};

  start(): void {
    try {
      if (process.platform === 'win32') this.backend = new WinBackend();
      else if (process.platform === 'darwin') this.backend = new SpawnBackend('afplay', (f, m) => ['-v', m ? '0.5' : '1', f]);
      else if (has('paplay')) this.backend = new SpawnBackend('paplay', (f) => [f]);
      else if (has('aplay')) this.backend = new SpawnBackend('aplay', (f) => ['-q', f]);
    } catch {
      this.backend = null;
    }
  }

  play(id: string): void {
    if (!this.backend || this.mode === 2 || !(id in SFX)) return;
    const now = Date.now();
    if (now - (this.last[id] ?? 0) < 45) return; // de-duplicate same-frame triggers
    this.last[id] = now;
    this.backend.play(id);
  }

  music(id: string | null): void {
    this.wantMusic = id;
    if (!this.backend) return;
    this.backend.music(this.mode === 0 ? id : null);
  }

  cycleMode(): AudioMode {
    this.mode = ((this.mode + 1) % 3) as AudioMode;
    this.music(this.wantMusic);
    return this.mode;
  }

  close(): void {
    this.backend?.close();
  }
}
