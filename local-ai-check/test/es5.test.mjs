// Every shipped script must parse as ES5 so the page runs on old browsers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { SCRIPT_ORDER } from '../build.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export default function test(assert) {
  for (const f of SCRIPT_ORDER) {
    const code = readFileSync(join(src, f), 'utf8');
    try {
      acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
      assert.ok(true, `${f} parses as ES5`);
    } catch (e) {
      assert.fail(`${f} is not ES5: ${e.message}`);
    }
  }
  // The built page's inline script must parse as ES5 too.
  const html = readFileSync(join(src, '..', '..', 'docs', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, 'built page has an inline script');
  for (const s of scripts) {
    try { acorn.parse(s, { ecmaVersion: 5 }); assert.ok(true, 'inline script parses as ES5'); }
    catch (e) { assert.fail(`built inline script is not ES5: ${e.message}`); }
  }
}
