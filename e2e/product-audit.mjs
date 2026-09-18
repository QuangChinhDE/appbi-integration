/**
 * A product audit pass: every route, every supported viewport, screenshots
 * plus the things a screenshot cannot show.
 *
 * `ux-walkthrough.mjs` walks one journey as a new customer. This walks the
 * *surface*: it visits every route the shell offers, at each viewport, and
 * records for each one
 *
 *   - a screenshot (to be opened and read -- capturing is not inspecting);
 *   - every console error and unhandled rejection the page produced;
 *   - every network request that failed or returned >= 400;
 *   - measured layout facts: horizontal overflow, the smallest text actually
 *     rendered (after ancestor transforms), whether a primary action is
 *     inside the viewport;
 *   - whether the page rendered a heading at all, which separates "route
 *     resolved" from "page rendered".
 *
 * The console/network capture is the part that earns its keep: a page can
 * look completely correct and still be firing a 500 on every load, or
 * swallowing a React error into an empty panel. Neither shows up in a
 * screenshot, and neither is asserted by the appearance suite.
 *
 *   node product-audit.mjs --out ./audit-screenshots
 *   node product-audit.mjs --out ./audit --only overview,workflows
 *
 * Writes `<out>/findings.json` with everything machine-readable, and one PNG
 * per route per viewport.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3010';
const EMAIL = process.env.AUDIT_EMAIL ?? 'admin@appbi.vn';
const PASSWORD = process.env.AUDIT_PASSWORD ?? 'E2EOwnerPassword123';

const args = process.argv.slice(2);
const outDir = valueOf('--out') ?? './audit-screenshots';
const only = valueOf('--only')?.split(',').map((s) => s.trim());

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'phone-390', width: 390, height: 844 },
];

/** Every route the shell offers. `needs` marks ones requiring a workflow id. */
const ROUTES = [
  { key: 'overview', path: '/overview' },
  { key: 'workflows', path: '/workflows' },
  { key: 'workflows-new', path: '/workflows/new' },
  { key: 'executions', path: '/executions' },
  { key: 'credentials', path: '/credentials' },
  { key: 'nodes', path: '/nodes' },
  { key: 'monitoring', path: '/monitoring' },
  { key: 'alerts', path: '/alerts' },
  { key: 'audit', path: '/audit' },
  { key: 'settings-workspace', path: '/settings/workspace' },
  { key: 'settings-access', path: '/settings/access' },
  { key: 'settings-engine', path: '/settings/engine' },
];

/** Layout facts a screenshot does not tell you, measured in the page. */
const MEASURE = () => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;

  let widest = null;
  if (overflow > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > doc.clientWidth + 1) {
        if (!widest || r.right > widest.right) {
          widest = { right: Math.round(r.right), tag: el.tagName,
                     cls: (el.className || '').toString().slice(0, 80) };
        }
      }
    }
  }

  // Effective font size: the CSS value multiplied by every transform scale
  // above it. A 12px label inside a canvas fitted at 0.75 reaches the eye at
  // 9px, and reading the CSS value alone reports 12 and is wrong.
  function effectiveScale(el) {
    let scale = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== 'none') {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map(Number);
          if (parts.length >= 4 && Number.isFinite(parts[0])) scale *= parts[0];
        }
      }
    }
    return scale;
  }

  let smallest = null;
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent || !el.textContent.trim()) continue;
    // Only leaf-ish nodes carry their own visible text.
    if (el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // The canvas is a zoomable surface and is excluded by policy (ADR-025).
    if (el.closest('.react-flow__viewport')) continue;
    const css = parseFloat(getComputedStyle(el).fontSize);
    const eff = css * effectiveScale(el);
    if (!smallest || eff < smallest.px) {
      smallest = { px: Math.round(eff * 10) / 10, css,
                   text: el.textContent.trim().slice(0, 40) };
    }
  }

  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .map((h) => h.textContent.trim()).filter(Boolean);

  // Anything that looks like a primary action, and whether it is reachable
  // without horizontal scrolling.
  const actions = [...document.querySelectorAll('button,a[role="button"]')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: (b.textContent || '').trim().slice(0, 40),
        clipped: r.right > doc.clientWidth + 1 || r.left < -1,
      };
    })
    .filter((a) => a.label);

  return {
    overflowPx: overflow,
    widestOffender: widest,
    smallestText: smallest,
    headings: headings.slice(0, 6),
    clippedActions: actions.filter((a) => a.clipped),
    actionCount: actions.length,
    bodyTextLength: (document.body.innerText || '').trim().length,
  };
};

const findings = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORTS[0] });
const page = await context.newPage();

// Sign in once; the session cookie is reused for every viewport and route.
console.log(`Auditing ${BASE} as ${EMAIL}`);
const login = await page.request.post(`${BASE}/api/v1/auth/login`, {
  data: { email: EMAIL, password: PASSWORD },
});
if (!login.ok()) {
  console.error(`could not sign in: ${await login.text()}`);
  await browser.close();
  process.exit(1);
}
console.log('signed in');

mkdirSync(outDir, { recursive: true });

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });

  for (const route of ROUTES) {
    if (only && !only.includes(route.key)) continue;

    const consoleErrors = [];
    const pageErrors = [];
    const badRequests = [];

    const onConsole = (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    };
    const onPageError = (err) => pageErrors.push(String(err).slice(0, 300));
    const onResponse = (res) => {
      if (res.status() >= 400) {
        badRequests.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`);
      }
    };
    const onRequestFailed = (req) => {
      badRequests.push(`FAILED ${req.method()} ${req.url().replace(BASE, '')} (${req.failure()?.errorText})`);
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    let measured = null;
    let error = null;
    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 30000 });
      // Let any post-load fetch settle -- a list that renders its skeleton and
      // then its rows should be screenshotted as rows.
      await page.waitForTimeout(1200);
      measured = await page.evaluate(MEASURE);
    } catch (e) {
      error = String(e).slice(0, 300);
    }

    const shot = join(outDir, `${route.key}--${vp.name}.png`);
    try {
      await page.screenshot({ path: shot, fullPage: false });
    } catch { /* a page that would not load has nothing to shoot */ }

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);

    const finding = {
      route: route.path,
      key: route.key,
      viewport: vp.name,
      screenshot: shot,
      url: page.url().replace(BASE, ''),
      error,
      consoleErrors,
      pageErrors,
      badRequests,
      ...(measured ?? {}),
    };
    findings.push(finding);

    const flags = [];
    if (error) flags.push('LOAD-ERROR');
    if (pageErrors.length) flags.push(`${pageErrors.length} PAGE-ERROR`);
    if (consoleErrors.length) flags.push(`${consoleErrors.length} console-error`);
    if (badRequests.length) flags.push(`${badRequests.length} bad-request`);
    if (measured?.overflowPx > 0) flags.push(`overflow ${measured.overflowPx}px`);
    if (measured?.smallestText && measured.smallestText.px < 12) {
      flags.push(`text ${measured.smallestText.px}px`);
    }
    if (measured?.clippedActions?.length) flags.push(`${measured.clippedActions.length} clipped`);
    if (measured && measured.headings.length === 0) flags.push('NO-HEADING');
    if (measured && measured.bodyTextLength < 80) flags.push('NEARLY-EMPTY');

    console.log(`  ${vp.name.padEnd(13)} ${route.path.padEnd(22)} ${flags.join(' · ') || 'ok'}`);
  }
}

writeFileSync(join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
console.log(`\nwrote ${findings.length} findings to ${join(outDir, 'findings.json')}`);

await browser.close();
