// Key bindings shared by the terminal and browser versions: raw key -> game action.
export const KEYMAP: Record<string, string> = {
  w: 'up', s: 'down', a: 'left', d: 'right',
  j: 'attack', x: 'attack', k: 'heavy', c: 'heavy',
  ' ': 'roll', q: 'parry', l: 'parry', f: 'flask', e: 'interact',
  i: 'inv', '\t': 'inv', m: 'map', '?': 'help', h: 'help', r: 'tool', b: 'journal', t: 'talents',
  u: 'skill1', o: 'skill2', p: 'skill3',
  '\r': 'enter', '\n': 'enter',
};

export const MOVE_KEYS = new Set(['up', 'down', 'left', 'right']);
