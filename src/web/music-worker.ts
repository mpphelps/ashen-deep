// Runs in a Web Worker: synthesizes every sound effect, then every music track, and posts them back.
import { SFX, MUSIC } from '../audio/sounds.ts';
import { SR } from '../audio/synth.ts';

const post = (kind: string, id: string, data: Float32Array) =>
  (self as unknown as Worker).postMessage({ kind, id, sr: SR, data }, [data.buffer]);

self.onmessage = (ev: MessageEvent) => {
  const first: string | undefined = ev.data?.first;
  for (const [id, gen] of Object.entries(SFX)) post('sfx', id, gen());
  // the track the player needs right now comes first
  const order = Object.keys(MUSIC).sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
  for (const id of order) post('music', id, MUSIC[id]());
  post('done', '', new Float32Array(1));
};
