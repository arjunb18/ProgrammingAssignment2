// Minimal test runner: node test/run.mjs [filter]. Each test file default-exports fn(assert).
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
let pass = 0, fail = 0;
const failures = [];

function makeAssert(file) {
  return {
    ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(`${file}: ${msg}`); } },
    fail(msg) { fail++; failures.push(`${file}: ${msg}`); },
    equal(a, b, msg) { this.ok(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); },
  };
}

const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort();
for (const f of files) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const before = fail;
  try { await mod.default(makeAssert(f)); }
  catch (e) { fail++; failures.push(`${f}: threw ${e && e.stack || e}`); }
  console.log(`${fail === before ? 'ok  ' : 'FAIL'} ${f}`);
}
for (const m of failures) console.log('  ✗ ' + m);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
