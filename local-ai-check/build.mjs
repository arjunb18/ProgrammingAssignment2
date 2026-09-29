// Builds the single-file app: inlines src/styles.css and src/*.js into src/index.template.html.
// Outputs:
//   ../docs/index.html      full HTML document (GitHub Pages serves the repo's /docs folder)
//   dist/artifact.html      same page without the doctype/html/head/body wrapper (claude.ai Artifact)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const SCRIPT_ORDER = [
  'util.js',
  'data/models.js',
  'data/gpus.js',
  'data/runtimes.js',
  'detect.js',
  'bench.js',
  'estimate.js',
  'ui.js',
  'main.js',
];

const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// A literal "</script" inside inlined JS would end the script element early.
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script');
const safeCss = (css) => css.replace(/<\/style/gi, '<\\/style');

export function build() {
  const template = read('index.template.html');
  const css = read('styles.css');
  const js = SCRIPT_ORDER.map((f) => `/* ---- ${f} ---- */\n${read(f)}`).join('\n');

  if (!template.includes('<!--STYLE-->') || !template.includes('<!--SCRIPTS-->')) {
    throw new Error('template is missing <!--STYLE--> or <!--SCRIPTS--> placeholder');
  }
  const full = template
    .replace('<!--STYLE-->', () => `<style>\n${safeCss(css)}\n</style>`)
    .replace('<!--SCRIPTS-->', () => `<script>\n${safeJs(js)}\n</script>`);

  // Artifact variant: keep head children (title, meta, links, style) and body content, drop wrappers.
  const artifact = full
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*$/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<meta charset="[^"]*">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<body[^>]*>\s*/i, '')
    .replace(/<\/body>\s*/i, '');

  // The font stylesheet must stay non-blocking in both outputs (media="print" + onload swap),
  // or a stalled fonts.googleapis.com holds back the whole page.
  for (const [name, html] of [['docs/index.html', full], ['dist/artifact.html', artifact]]) {
    if (!/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*media="print" onload="this\.media='all'">/.test(html)) {
      throw new Error(`${name}: the Google Fonts link lost its non-blocking media/onload attributes`);
    }
  }

  mkdirSync(join(root, '..', 'docs'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, '..', 'docs', 'index.html'), full);
  writeFileSync(join(root, 'dist', 'artifact.html'), artifact);
  return { bytes: Buffer.byteLength(full), artifactBytes: Buffer.byteLength(artifact) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`docs/index.html ${(r.bytes / 1024).toFixed(1)} KB, dist/artifact.html ${(r.artifactBytes / 1024).toFixed(1)} KB`);
}
