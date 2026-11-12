// Save file on disk, for the terminal version.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SaveStore } from './platform.ts';

const SAVE_PATH = path.join(os.homedir(), '.ashen-deep-save.json');

export const fileStore: SaveStore = {
  read: () => {
    try {
      return fs.existsSync(SAVE_PATH) ? fs.readFileSync(SAVE_PATH, 'utf8') : null;
    } catch {
      return null;
    }
  },
  write: (d) => {
    try {
      fs.writeFileSync(SAVE_PATH, d);
    } catch {
      /* ignore */
    }
  },
};
