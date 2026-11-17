#!/usr/bin/env node
/*
 * Ґуґля — збирач каталогу з терміналу (Node + Playwright, справжній Chrome).
 * Логіка та сама, що в scraper.js: скрипт відкриває сайт бренду (проходить Cloudflare як звичайний браузер)
 * і виконує scraper.js на сторінці, тож схема полів ідентична.
 *
 *   cd data/database && npm install
 *   node scrape.mjs --out E:\guglya\raw                       # усі бренди з brands.json
 *   node scrape.mjs --out E:\guglya\raw --only oslo,him        # лише ці
 *   node scrape.mjs --out E:\guglya\raw --skip papaya,ctrl     # крім цих
 *
 * Опції: --limit 300, --parallel 3, --timeout 20 (хв на бренд), --headed, --force (перезаписати наявні файли),
 *        --chromium (вбудований Chromium замість встановленого Chrome).
 * Бренди, для яких уже є <out>/guglya_<id>.json, пропускаються (якщо не --force).
 * Файл пишеться лише якщо знайдено хоча б один товар.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes('--' + k);
const list = (k) => (opt(k, '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const OUT = opt('out', '.');
const LIMIT = +opt('limit', 300);
const PARALLEL = +opt('parallel', 3);
const TIMEOUT_MS = +opt('timeout', 20) * 60_000;
const ONLY = list('only'), SKIP = list('skip');
const SCRAPER = readFileSync(join(HERE, 'scraper.js'), 'utf-8');
const BRANDS = JSON.parse(readFileSync(join(HERE, 'brands.json'), 'utf-8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, ...m) => console.log(new Date().toISOString().slice(11, 19), id.padEnd(16), ...m);
const CF = /just a moment|attention required|один момент|трохи зачекайте|подождите|checking your browser|verify you are human/i;
const BLOCKED = /^(403|401|429)\b|forbidden|access denied/i;

async function scrapeBrand(browser, b) {
  // headless Chrome представляється як "HeadlessChrome" — частина сайтів (nginx/WAF) на це дає 403
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const ctx = await browser.newContext({ bypassCSP: true, locale: 'uk-UA', userAgent: ua, viewport: { width: 1366, height: 900 } });
  ctx.setDefaultTimeout(60_000);
  // сторінка повинна лишатись на місці, поки scraper.js працює: блокуємо важкі ресурси, не навігацію
  await ctx.route('**/*', (r) => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
  const page = await ctx.newPage();
  try {
    await page.goto(b.site, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    for (let i = 0; i < 30 && CF.test(await page.title().catch(() => '')); i++) await sleep(2000);
    const title = await page.title().catch(() => '');
    if (CF.test(title)) throw new Error('Cloudflare challenge not passed' + (flag('headed') ? ' (interactive check, needs a human)' : ' (try --headed)'));
    if (BLOCKED.test(title)) throw new Error('site blocked the browser: ' + title);
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    log(b.id, 'opened', page.url());
    const cfg = { id: b.id, name: b.name, gender: b.default_gender, kind: b.kind, limit: LIMIT, download: false };
    await page.evaluate(`window.__cfg = ${JSON.stringify(cfg)};\n${SCRAPER}`);
    const t0 = Date.now();
    let lastLog = 0;
    for (;;) {
      await sleep(5000);
      const g = await page.evaluate(() => {
        const G = window.__g;
        return G && { status: G.status, mode: G.mode, found: G.found, checked: G.checked, candidates: G.candidates, stop: !!G.stop };
      });
      if (!g) throw new Error('scraper state lost (page navigated?)');
      if (g.status !== 'running') break;
      const s = `${g.mode} found ${g.found} checked ${g.checked}/${g.candidates}`;
      if (Date.now() - lastLog > 60_000) { log(b.id, s); lastLog = Date.now(); }
      if (!g.stop && Date.now() - t0 > TIMEOUT_MS) {
        log(b.id, 'timeout, finishing with what is collected:', s);
        await page.evaluate(() => { window.__g.stop = true; });
      }
      if (Date.now() - t0 > TIMEOUT_MS + 5 * 60_000) throw new Error('did not finish after stop');
    }
    const res = await page.evaluate(() => ({ status: window.__g.status, result: window.__g.result, errors: window.__g.errors }));
    if (res.status !== 'done' || !res.result) throw new Error('scraper error: ' + (res.errors || []).slice(-1)[0]);
    return res.result;
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const todo = BRANDS.filter((b) => (!ONLY.length || ONLY.includes(b.id)) && !SKIP.includes(b.id))
    .filter((b) => flag('force') || !existsSync(join(OUT, `guglya_${b.id}.json`)));
  console.log(`brands to scrape: ${todo.length} → ${OUT}\n${todo.map((b) => b.id).join(', ')}`);
  const browser = await chromium.launch({
    headless: !flag('headed'),
    channel: flag('chromium') ? undefined : 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const summary = [];
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const b = todo[i++];
      const t = Date.now();
      try {
        const doc = await scrapeBrand(browser, b);
        const m = doc._meta;
        if (m.count > 0) writeFileSync(join(OUT, `guglya_${b.id}.json`), JSON.stringify(doc, null, 2), 'utf-8');
        summary.push({ id: b.id, ok: m.count > 0, count: m.count, mode: m.mode, found: m.found, checked: m.checked, candidates: m.candidates, min: +((Date.now() - t) / 60000).toFixed(1), note: m.count ? '' : (m.errors[0] || 'no products found') });
        log(b.id, `DONE ${m.count} products (${m.mode}, found ${m.found}, checked ${m.checked}/${m.candidates})`);
      } catch (e) {
        summary.push({ id: b.id, ok: false, count: 0, min: +((Date.now() - t) / 60000).toFixed(1), note: String(e.message || e).split('\n')[0].slice(0, 160) });
        log(b.id, 'FAIL', String(e.message || e).split('\n')[0]);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  await browser.close();
  writeFileSync(join(OUT, '_scrape_log.json'), JSON.stringify({ at: new Date().toISOString(), summary }, null, 2), 'utf-8');
  console.log('\nSUMMARY');
  for (const s of summary.sort((a, b) => b.count - a.count)) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.id.padEnd(16)} ${String(s.count).padStart(4)}  ${s.mode || ''} ${s.note || ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
