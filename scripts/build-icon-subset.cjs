#!/usr/bin/env node
/*
 * Builds the icon stylesheet the renderer ships, from the icons it actually uses.
 *
 * WHY NOT MONITOR'S FILE AS IT STANDS. Monitor generates one stylesheet holding
 * the whole Tabler set — 6,011 icons, 2.8 MB — which is reasonable for a web app
 * behind a CDN and is not reasonable for something parsed on every cold start of
 * a desktop app. This app uses about a hundred of them.
 *
 * WHY NOT @iconify/tools, WHICH IS WHAT MONITOR RUNS. It carries a critical
 * advisory through `tar` and a high one through `extract-zip`, both path
 * traversals, and it would be a build dependency of an app we ship. It is not
 * needed: Monitor's generated file is already a base rule plus one `--svg` rule
 * per icon, so the subset is a text operation over a file we have.
 *
 * WHAT IT DOES. Scans the renderer for `tabler-…` class names, pulls those rules
 * out of the source stylesheet, and writes them with the shared base rule
 * narrowed to the same set. Icons are DATA URIs inside the CSS, so nothing is
 * fetched at runtime and the app renders the same with no network at all.
 *
 * Node built-ins only, like every other script here.
 *
 *   node scripts/build-icon-subset.cjs [path-to-generated-icons.css]
 */
const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')

const ROOT = join(__dirname, '..')
const SOURCE_DIR = join(ROOT, 'electron', 'renderer')
const OUT = join(SOURCE_DIR, 'styles', 'icons.css')

const DEFAULT_SOURCE = join(
  ROOT,
  '..',
  'TrackVid-Monitor',
  'src',
  'assets',
  'iconify-icons',
  'generated-icons.css'
)

const source = process.argv[2] ?? DEFAULT_SOURCE

/** Every `.tsx`/`.ts` under the renderer. */
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)

    if (statSync(path).isDirectory()) walk(path)
    else if (/\.tsx?$/.test(entry)) files.push(path)
  }
}
walk(SOURCE_DIR)

/*
 * Class names are written as `tabler-chevron-right`, in a className string, a
 * template literal or a config object. Matching the bare token rather than a
 * full class attribute is what catches all three.
 */
const used = new Set()

for (const path of files) {
  for (const [, name] of readFileSync(path, 'utf8').matchAll(/\b(tabler-[a-z0-9-]+)\b/g)) {
    used.add(name)
  }
}

let css
try {
  css = readFileSync(source, 'utf8')
} catch {
  console.error(`Cannot read the icon source: ${source}`)
  console.error('Pass the path to Monitor\'s generated-icons.css as the first argument.')
  process.exit(1)
}

// The shared rule: its declarations are the same for every icon; only the
// selector list changes.
const base = css.slice(css.indexOf('{'), css.indexOf('}') + 1)

const rules = new Map()
for (const [, name, body] of css.matchAll(/\n\.([a-z0-9-]+)\s*\{\s*(--svg:[^}]+)\}/g)) {
  rules.set(name, body.trim())
}

const found = [...used].filter((name) => rules.has(name)).sort()
const missing = [...used].filter((name) => !rules.has(name)).sort()

if (found.length === 0) {
  console.error('No icons matched. Has the renderer stopped using `tabler-…` class names?')
  process.exit(1)
}

const body = [
  '/*',
  ' * GENERATED — do not edit. `npm run icons` rewrites this file.',
  ' *',
  ' * The icons this app uses, as data URIs, extracted from the Tabler set that',
  ' * TrackVid-Monitor bundles. Nothing here is fetched at runtime: the app has to',
  ' * render identically on a machine with no network.',
  ' *',
  ` * ${found.length} icons, from ${relative(ROOT, source) || source}.`,
  ' */',
  '',
  found.map((name) => `.${name}`).join(',\n') + ' ' + base,
  '',
  ...found.map((name) => `.${name} {\n  ${rules.get(name)}\n}`),
  ''
].join('\n')

writeFileSync(OUT, body, 'utf8')

const kb = (n) => `${Math.round(n / 1024)} KB`

console.log(
  `icons — ${found.length} of ${rules.size} available, ${kb(body.length)} (source ${kb(css.length)})`
)

if (missing.length > 0) {
  console.warn(`\n${missing.length} class name(s) had no icon in the source:`)
  for (const name of missing) console.warn(`  ${name}`)
  console.warn('\nEither the name is wrong, or the source set does not carry it.')
}
