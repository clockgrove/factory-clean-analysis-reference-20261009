import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
const alias = dirname(execFileSync('bash', ['-c', 'command -v qualification-chromium'], {encoding: 'utf8'}).trim());
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(alias, '../browsers');
await mkdir('.runtime/browser-tmp', {recursive: true});
const {chromium} = await import('playwright');
const incident = {id: 'INC-COMPONENT', title: 'Component incident', description: '<text>', service: 'Billing', severity: 'high', status: 'open', openedAt: '2026-04-01T00:00:00.000Z', resolvedAt: null, team: 'Team', region: 'AMER', tags: []};
const services = [{service: 'Search', incidentCount: 4, unresolvedCount: 1, highSeverityCount: 2, averageResolutionHours: 2.5}, {service: 'Billing', incidentCount: 3, unresolvedCount: 3, highSeverityCount: 1, averageResolutionHours: null}];
const result = {page: 1, pageSize: 25, total: 7, totalPages: 1, items: [incident], summary: {total: 7, unresolved: 4, highSeverity: 3, openedByDay: [], services}};
async function until(read, expected) {
  const end = Date.now() + 10000;
  do { if (await read() === expected) return; await new Promise(r => setTimeout(r, 20)); } while (Date.now() < end);
  assert.equal(await read(), expected);
}
// Controlled component inputs verify the actual app DOM. These are not backend integration evidence.
test('workspace DOM: overview ownership, triage focus, stable text notes and storage limitations', {timeout: 45000}, async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? 'index.html' : req.url.slice(1);
      if (!['index.html', 'app.js', 'state.js', 'triage.js', 'styles.css'].includes(path)) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(new URL(`../../public/${path}`, import.meta.url)));
    } catch { res.writeHead(500); res.end(); }
  });
  let browser;
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await chromium.launch({channel: 'chromium', headless: true, chromiumSandbox: true, env: {PATH: process.env.PATH, HOME: process.env.HOME, LD_LIBRARY_PATH: resolve(alias, '../host-libs/usr/lib/x86_64-linux-gnu'), ALSA_CONFIG_PATH: resolve(alias, '../host-libs/usr/share/alsa/alsa.conf'), TMPDIR: '.runtime/browser-tmp', TMP: '.runtime/browser-tmp', TEMP: '.runtime/browser-tmp'}});
    const page = await browser.newPage({viewport: {width: 375, height: 812}}); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('incident-explorer.triage.v1', '{bad JSON');
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === 'incident-explorer.triage.v1') throw Error('quota denied'); return original.call(this, key, value); };
    });
    let response = result, fail = false;
    await page.route('**/api/incidents?*', route => fail ? route.fulfill({status: 503, json: {error: {message: 'Component query failed'}}}) : route.fulfill({json: response}));
    await page.route('**/api/incidents/INC-COMPONENT', route => route.fulfill({json: incident}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await until(() => page.locator('#freshness').textContent(), 'Current selections');
    assert.deepEqual(await page.locator('.service-card h4').allTextContents(), ['Billing', 'Search']);
    assert.match(await page.locator('.service-card').first().textContent(), /Unavailable/);
    assert.match(await page.locator('#triage-storage').textContent(), /could not be read/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#rows button').first().focus(); await page.keyboard.press('Enter');
    await until(() => page.locator('#detail-content dd').count(), 11);
    await page.getByRole('button', {name: 'Add to triage', exact: true}).click();
    assert.match(await page.locator('#triage-storage').textContent(), /could not be saved/);
    await page.keyboard.press('Escape'); await until(() => page.locator('#rows button').first().evaluate(x => x === document.activeElement), true);
    const note = page.getByLabel('Personal note for INC-COMPONENT (1000 characters maximum)');
    const text = '<script>plain text</script> & "quotes"'; await note.fill(text);
    await note.evaluate(x => { window.noteControl = x; });
    fail = true; await page.locator('#search').fill('different'); await page.locator('#search').press('Enter');
    await until(() => page.locator('#result-message').textContent(), 'Component query failedRetry');
    assert.match(await page.locator('#overview-selection').textContent(), /Previous completed selection: All incidents · Requested now: Search: different/);
    await note.fill(`${text} retained`);
    assert.equal(await note.evaluate(x => x === window.noteControl), true);
    assert.match(await page.locator('#result-message').textContent(), /Component query failed/);
    const open = page.getByRole('button', {name: 'Open triage incident INC-COMPONENT', exact: true});
    await open.focus(); await page.keyboard.press('Enter'); await until(() => page.locator('#detail-content dd').count(), 11);
    await page.keyboard.press('Escape'); await until(() => open.evaluate(x => x === document.activeElement), true);
    assert.equal(await page.locator('#search').inputValue(), 'different');
    fail = false; response = {...result, items: [], total: 0, totalPages: 0, summary: {...result.summary, total: 0, services: []}};
    await page.locator('#result-message button').click();
    await until(() => page.locator('#service-measures').textContent(), 'No matching services. Try clearing a filter or changing your search.');
    assert.equal(await note.inputValue(), `${text} retained`); assert.equal(await note.evaluate(x => x === window.noteControl), true);
    await page.getByRole('button', {name: 'Remove triage incident INC-COMPONENT and its note', exact: true}).click();
    assert.equal(await note.count(), 0);
    response = {...result, summary: {total: 7, unresolved: 4, highSeverity: 3, openedByDay: []}};
    await page.locator('#clear').click(); await until(() => page.locator('#service-measures').textContent(), 'Service measures are unavailable from this backend version.');
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
  }
});
