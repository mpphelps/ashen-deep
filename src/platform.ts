// The few things the game needs from the outside world, so the same core runs in a terminal or a browser.

export interface SaveStore {
  read(): string | null;
  write(data: string): void;
}

const memory = new Map<string, string>();
let store: SaveStore = {
  read: () => memory.get('save') ?? null,
  write: (d) => void memory.set('save', d),
};

export function setSaveStore(s: SaveStore): void {
  store = s;
}
export function saveStore(): SaveStore {
  return store;
}
