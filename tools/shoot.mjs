#!/usr/bin/env node
/**
 * shoot.mjs — capture full-page screenshots of the running Angular app so a
 * redesign can be compared against a target mockup.
 *
 * The screenshot-driven redesign loop: edit SCSS -> `npm run shoot -- <route>`
 * -> Read the PNG (and the target in specs/{feature}/mockups/) -> reason about
 * the spacing/color/alignment delta -> edit again. The renders are ephemeral
 * (they land in a scratch dir, not committed); the target mockups are the
 * committed artifacts.
 *
 * Usage:
 *   node tools/shoot.mjs <route...> [--vw 1440x900[,390x844,...]] [--out <dir>] [--base <url>]
 *   npm run shoot -- /stats
 *   npm run shoot -- / /browse /stats --vw 1440x900,390x844
 *   npm run shoot -- /study/all --out ./scratch
 *
 * Routes: any app path. Param-free targets that always work:
 *   /  /browse  /stats  /study/all  /options/opts-default
 * (`/study/all` studies all decks; `opts-default` is the seeded deck-options id,
 *  see server/src/store/seed.ts). For a specific deck, pass /study/<deckId> —
 *  discover ids via GET <base>/api/collection -> decks[].id.
 *
 * Requires `npm run dev` to be running first: web on :4200 proxies /api and
 * /media to the Express server on :3000, and every route past `/` needs that
 * data to render. This script does not start the servers.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_BASE = 'http://localhost:4200';
const DEFAULT_VIEWPORTS = '1440x900';
const DEFAULT_OUT =
  process.env.CLAUDE_SCRATCHPAD_DIR ||
  process.env.TMPDIR ||
  '/tmp';

function parseArgs(argv) {
  const routes = [];
  let vw = DEFAULT_VIEWPORTS;
  let out = DEFAULT_OUT;
  let base = DEFAULT_BASE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vw') vw = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a === '--base') base = argv[++i];
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else routes.push(a);
  }
  return { routes, vw, out, base };
}

function parseViewports(vw) {
  return vw.split(',').map((s) => {
    const m = /^(\d+)x(\d+)$/.exec(s.trim());
    if (!m) {
      console.error(`Bad --vw value "${s}"; expected WxH like 1440x900`);
      process.exit(2);
    }
    return { width: Number(m[1]), height: Number(m[2]) };
  });
}

// "/study/all" -> "study-all", "/" -> "root"
function slug(route) {
  const s = route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-');
  return s || 'root';
}

async function reachable(base) {
  try {
    // AbortSignal.timeout keeps a down server from hanging the preflight.
    await fetch(base, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { routes, vw, out, base } = parseArgs(process.argv.slice(2));
  if (routes.length === 0) {
    console.error(
      'Usage: node tools/shoot.mjs <route...> [--vw WxH[,WxH]] [--out dir] [--base url]',
    );
    process.exit(2);
  }
  const viewports = parseViewports(vw);

  if (!(await reachable(base))) {
    console.error(
      `Dev server not reachable at ${base}. Run \`npm run dev\` first ` +
        `(web :4200 + server :3000), then re-run.`,
    );
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: vp });
      for (const route of routes) {
        const path = route.startsWith('/') ? route : `/${route}`;
        const url = base + path;
        await page.goto(url, { waitUntil: 'networkidle' });
        const file = join(out, `${slug(path)}@${vp.width}x${vp.height}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(file);
        console.log(file);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (written.length === 0) {
    console.error('No screenshots written.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
