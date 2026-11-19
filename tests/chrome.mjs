import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function until(check) {
  for (let i = 0; i < 100; i++) {
    const result = await check();
    if (result) return result;
    await pause(50);
  }
  assert.fail(`browser condition not reached: ${check}`);
}

export async function openChrome(t, profile, page) {
  const chrome = spawn(process.env.RADAR_CHROME, [
    '--headless', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-dev-shm-usage',
    // Bulk case auditing intentionally exceeds Chromium's 200-navigation IPC throttle.
    '--disable-ipc-flooding-protection',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let startError;
  chrome.on('error', (error) => { startError = error; });
  const exited = new Promise((resolve) => chrome.once('close', resolve));
  let ws;
  t.after(async () => {
    ws?.close();
    chrome.kill();
    await exited;
  });
  const port = await until(() => {
    if (startError || chrome.exitCode !== null) throw startError ?? new Error(`Chromium exited ${chrome.exitCode}`);
    try { return readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  const target = await until(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find((tab) => tab.type === 'page');
  });
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const external = [];
  ws.addEventListener('message', ({ data }) => {
    const { id, result, error, method, params } = JSON.parse(data);
    if (id && pending.has(id)) {
      pending.get(id)(error ? new Error(error.message) : null, result);
      pending.delete(id);
    } else if (method === 'Runtime.exceptionThrown' || method === 'Runtime.consoleAPICalled' && params.type === 'error' ||
               method === 'Log.entryAdded' && params.entry.level === 'error') {
      errors.push(params);
    } else if (method === 'Network.requestWillBeSent' && /^https?:/i.test(params.request.url)) {
      external.push(params.request.url);
    }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id;
    pending.set(request, (error, result) => error ? reject(error) : resolve(result));
    ws.send(JSON.stringify({ id: request, method, params }));
  });
  const value = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description);
    return result.result.value;
  };
  await Promise.all(['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable'].map((method) => cdp(method)));
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const href = pathToFileURL(page).href;
  const loaded = await cdp('Page.navigate', { url: href });
  assert.equal(loaded.errorText, undefined, `load ${href}: ${loaded.errorText}`);
  await until(() => value(`location.href === ${JSON.stringify(href)} && document.readyState === 'complete'`));
  t.after(() => {
    assert.deepEqual(errors, [], 'no console errors or exceptions');
    assert.deepEqual(external, [], 'no outbound requests attempted');
  });
  return { value, cdp };
}
