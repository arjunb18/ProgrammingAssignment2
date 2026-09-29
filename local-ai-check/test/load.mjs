// Loads the browser scripts into a Node vm context with a minimal fake `window`,
// so pure modules (data, estimate, gpu matching) can be unit tested.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export function loadLAC(files) {
  const store = {};
  const window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
  const ctx = vm.createContext({ window, console, setTimeout, clearTimeout, Promise, Math, JSON, Date });
  for (const f of files) {
    vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });
  }
  return window.LAC;
}
