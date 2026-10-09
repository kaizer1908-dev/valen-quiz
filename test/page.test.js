'use strict';
/*
 * Tests of index.html (slices F2 and F3).
 * Static checks read the page as text and compile its inline scripts with node:vm.
 * "run" tests execute the real page scripts against a small hand-written fake DOM (no browser, no jsdom,
 * no network): a fake fetch, a fake clock and an in-memory storage are injected.
 * Run: node --test test/page.test.js
 * Fixtures use fake values only (phones 010-0000-xxxx, name 테스트참가자, staff PIN 7391 inside this file only).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULTS = require('../defaults.js');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Inline scripts only: <script> tags without src, skipping JSON data blocks.
function inlineScripts(source) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (!/\bsrc\s*=/.test(m[1]) && !/application\/json/.test(m[1])) { out.push(m[2]); }
  }
  return out;
}
const scripts = inlineScripts(html);
const app = scripts[scripts.length - 1];
const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, '');

// ============================================================================================ static: F2
test('F2 page: script tags load defaults.js and quiz-core.js with the same ?v= build', () => {
  const d = html.match(/<script\s+src="defaults\.js\?v=([^"]+)"\s*><\/script>/);
  const c = html.match(/<script\s+src="quiz-core\.js\?v=([^"]+)"\s*><\/script>/);
  assert.ok(d, 'defaults.js script tag with ?v= is missing');
  assert.ok(c, 'quiz-core.js script tag with ?v= is missing');
  assert.strictEqual(d[1], c[1], 'the two ?v= values must be identical');
  assert.strictEqual(d[1], DEFAULTS.build, 'the ?v= value must equal the build in defaults.js');
  const firstInline = html.search(/<script(?![^>]*\bsrc=)/);
  assert.ok(html.indexOf(d[0]) < firstInline && html.indexOf(c[0]) < firstInline, 'external scripts load before the inline ones');
});

test('F2 page: required data-testid hooks exist', () => {
  const hooks = ['landing-start', 'card-skip', 'field-name', 'field-org', 'field-phone', 'field-email',
    'consent-required', 'consent-marketing', 'info-next', 'q-title', 'q-hint', 'q-answer', 'q-next',
    'saving-root', 'saving-retry', 'error-card'];
  hooks.forEach((h) => {
    assert.ok(markup.indexOf('data-testid="' + h + '"') !== -1, 'missing data-testid="' + h + '" in the static markup');
  });
  // Input limits match the server (name 40, organization 80, email 254).
  [['field-name', 40], ['field-org', 80], ['field-email', 254]].forEach(([id, max]) => {
    const tag = markup.match(new RegExp('<input[^>]*data-testid="' + id + '"[^>]*>'));
    assert.ok(tag && tag[0].indexOf('maxlength="' + max + '"') !== -1, id + ' needs maxlength ' + max);
  });
  // The error card carries the code it shows.
  assert.ok(/data-testid="error-card"[^>]*data-error-code=/.test(markup), 'error-card needs data-error-code');
});

test('F2 page: no google.script, iframe, script.google.com navigation, pushState or replaceState', () => {
  ['google.script', '<iframe', 'script.google.com', 'pushState', 'replaceState'].forEach((s) => {
    assert.strictEqual(html.indexOf(s), -1, 'forbidden text found: ' + s);
  });
  const mutations = [
    /location\.(href|hash|search|pathname)\s*=(?!=)/,
    /location\.(assign|replace)\s*\(/,
    /\bhistory\./,
    /window\.open\s*\(/
  ];
  mutations.forEach((re) => assert.ok(!re.test(html), 'the page must not change the URL: ' + re));
  // Demo must not touch the real storage keys or the network: every storage call passes the prefix options,
  // and the real api is only created when demo is off.
  const storageCalls = app.match(/Q\.(loadState|saveState|resetForEvent|submitWithPending|getDeviceId)\([^)]*\)/g) || [];
  assert.ok(storageCalls.length >= 5, 'expected the storage calls to be found');
  storageCalls.forEach((c) => assert.ok(/\bSO\b/.test(c), 'storage call without the prefix options: ' + c));
  assert.ok(/demo \? Q\.createDemoApi\(\) : Q\.createApi\(/.test(app), 'demo must use the in-memory api');
  // The staff PIN value never appears here, and no Config key is needed on this page.
  assert.strictEqual(html.indexOf('246810'), -1);
});

test('F2 page: landing contains the POP title and tagline verbatim', () => {
  const m = markup.match(/<section[^>]*id="p-landing"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(m, 'landing section missing');
  const landing = m[1];
  assert.ok(landing.includes('Valen 행운퀴즈'));
  assert.ok(landing.includes('힌트 보면 다 맞혀요. 1분이면 경품까지'));
  [
    '참여 방법',
    '명함을 명함함에 넣어 주세요 (명함이 없으면 다음 화면에서 정보를 입력해요)',
    '행운퀴즈를 풀어요',
    '응모권을 받아 행운의 룰렛을 돌려요',
    '기프트백을 받아 가세요',
    '시작하기',
    '참여 정보는 행사 운영 목적으로만 사용돼요.'
  ].forEach((s) => assert.ok(landing.includes(s), 'landing is missing: ' + s));
  assert.ok(/<title>Valen 행운퀴즈<\/title>/.test(html));
});

test('F2 page: inline script parses (vm.Script) and uses no ?. or ??', () => {
  assert.ok(scripts.length >= 2, 'expected the safety-net script and the app script');
  scripts.forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code, { filename: 'index.html#script' + i }), 'inline script ' + i + ' must parse');
    assert.ok(!/\?\./.test(code), 'optional chaining found in inline script ' + i);
    assert.ok(!/\?\?/.test(code), 'nullish coalescing found in inline script ' + i);
    // Other syntax newer than ES2017 that older in-app browsers reject.
    assert.ok(!/catch\s*\{/.test(code), 'optional catch binding (ES2019) found in inline script ' + i);
    assert.ok(!/\{\s*\.\.\./.test(code), 'object spread (ES2018) found in inline script ' + i);
    assert.ok(!/\*\*/.test(code), '** found in inline script ' + i);
    assert.ok(!/\(\?<[=!a-zA-Z]/.test(code), 'lookbehind or named group (ES2018 regex) found in inline script ' + i);
    assert.ok(!/\\p\{/.test(code), 'unicode property escape (ES2018 regex) found in inline script ' + i);
  });
});

// ============================================================================================ static: F2 review fixes
test('F2r page: every id the script binds exists in the markup', () => {
  const ids = new Set();
  let m;
  const reDollar = /\$\('([^']+)'\)/g;
  while ((m = reDollar.exec(app)) !== null) { ids.add(m[1]); }
  const reGet = /getElementById\('([^']+)'\)/g;
  while ((m = reGet.exec(app + scripts[0])) !== null) { ids.add(m[1]); }
  [/var PAGES = \[([^\]]*)\]/, /var ids = \{([^}]*)\}/].forEach((re) => {
    const lit = app.match(re);
    assert.ok(lit, 'expected to find ' + re);
    const reStr = /'([a-z][a-z0-9-]*)'/g;
    let s;
    while ((s = reStr.exec(lit[1])) !== null) { if (s[1].indexOf('-') !== -1) { ids.add(s[1]); } }
  });
  assert.ok(ids.size > 40, 'expected the page to bind many ids, found ' + ids.size);
  ids.forEach((id) => assert.ok(markup.indexOf(' id="' + id + '"') !== -1, 'script binds #' + id + ' but the markup has no such id'));
});

test('F2r page: comments are English only and the page declares a dark color scheme', () => {
  const htmlComments = html.match(/<!--[\s\S]*?-->/g) || [];
  htmlComments.forEach((c) => assert.ok(!/[\u3131-\uD79D]/.test(c), 'Korean in an HTML comment: ' + c.slice(0, 60)));
  scripts.forEach((code, i) => {
    code.split('\n').forEach((line) => {
      const at = line.search(/(^|\s)\/\//);
      if (at !== -1) { assert.ok(!/[\u3131-\uD79D]/.test(line.slice(at)), 'Korean in a script comment (script ' + i + '): ' + line.trim()); }
    });
  });
  assert.ok(/<meta name="color-scheme" content="dark">/.test(html));
});

test('F2r page: boot copy, phone input and answer input attributes are pinned', () => {
  assert.ok(/<section[^>]*id="boot-card"[^>]*>\s*<p>잠시 후 새로고침해 주세요\. 계속 안 되면 부스 스태프에게 말씀해 주세요\.<\/p>/.test(markup));
  const phone = markup.match(/<input[^>]*data-testid="field-phone"[^>]*>/)[0];
  ['type="tel"', 'inputmode="numeric"', 'placeholder="010-1234-5678"'].forEach((a) => assert.ok(phone.indexOf(a) !== -1, 'phone input needs ' + a));
  const answer = markup.match(/<input[^>]*data-testid="q-answer"[^>]*>/)[0];
  ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'placeholder="정답을 입력해 주세요"'].forEach((a) => assert.ok(answer.indexOf(a) !== -1, 'answer input needs ' + a));
  assert.ok(markup.indexOf('체크하면 정보 입력 없이 퀴즈를 풀 수 있어요.') !== -1, 'card checkbox subline');
});

test('F2r page: async callbacks are guarded and both global error handlers are registered', () => {
  assert.ok(/addEventListener\('error'/.test(scripts[0]));
  // In-app browsers inject unhandled rejections of their own, so only the error event is listened to.
  assert.ok(!/unhandledrejection/.test(scripts[0] + app));
  // Every promise callback that touches the page goes through guard(), whether it is inline or a named function.
  const thens = app.split('.then(').slice(1);
  assert.ok(thens.length >= 4, 'expected to find the promise callbacks');
  thens.forEach((t) => assert.ok(t.startsWith('guard('), 'a .then callback is not wrapped in guard(): .then(' + t.slice(0, 30)));
});

// ============================================================================================ static: F3
test('F3 page: ticket and staff hooks exist (ticket-root, ticket-no, ticket-issued, ticket-status, ticket-clock, staff-toggle, staff-pin, staff-redeem, staff-result)', () => {
  ['ticket-root', 'ticket-no', 'ticket-issued', 'ticket-status', 'ticket-clock', 'staff-toggle', 'staff-pin', 'staff-redeem', 'staff-result']
    .forEach((h) => assert.ok(markup.indexOf('data-testid="' + h + '"') !== -1, 'missing data-testid="' + h + '"'));
  assert.ok(/id="ticket-slot"[^>]*data-testid="ticket-root"/.test(markup), '#ticket-slot carries ticket-root');
  ['행운의 룰렛 응모권', '응모권은 1인 1회만 사용할 수 있어요.', '스태프 확인', '룰렛 완료 처리']
    .forEach((s) => assert.ok(markup.indexOf(s) !== -1, 'missing copy: ' + s));
  const clockRule = html.match(/\.ticket \.clock \{[^}]*\}/);
  assert.ok(clockRule && clockRule[0].indexOf('tabular-nums') !== -1, 'the clock needs tabular-nums');
});

test('F3 page: staff PIN input is password/numeric/autocomplete off and no storage write references the PIN', () => {
  const pin = markup.match(/<input[^>]*data-testid="staff-pin"[^>]*>/)[0];
  ['type="password"', 'inputmode="numeric"', 'autocomplete="off"'].forEach((a) => assert.ok(pin.indexOf(a) !== -1, 'PIN input needs ' + a));
  app.split('\n').forEach((line) => {
    if (/setItem|saveState|localStorage|sessionStorage|persist\(|location\.|history\./.test(line)) {
      assert.ok(!/pin/i.test(line), 'a storage or URL line mentions the PIN: ' + line.trim());
    }
  });
  assert.ok(!/state\.(pin|staffPin)|ticket\.pin/i.test(app), 'the PIN must not be put on state or on the stored ticket');
  // The PIN is read once, cleared at once, and only ever passed to api.redeem.
  assert.strictEqual((app.match(/\$\('staff-pin'\)\.value/g) || []).length, 2, 'read once and cleared once');
  assert.strictEqual((app.match(/pin: pin/g) || []).length, 1, 'the PIN is placed only in the redeem request body');
});

// ============================================================================================ fake DOM
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
class El {
  constructor(tag, attrs) {
    this.tagName = tag; this.attrs = Object.assign({}, attrs || {}); this.children = []; this.parent = null; this._text = '';
    this.id = this.attrs.id || ''; this.hidden = 'hidden' in this.attrs; this.value = this.attrs.value || ''; this.checked = false;
    this.disabled = 'disabled' in this.attrs; this.readOnly = false; this.className = this.attrs.class || ''; this.listeners = {};
    this.type = this.attrs.type || (tag === 'button' ? 'submit' : ''); this.focused = false;
    const self = this;
    this.classList = {
      add(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = Array.from(s).join(' '); },
      remove(c) { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle(c, on) { if (on) { this.add(c); } else { this.remove(c); } },
      contains(c) { return self.className.split(/\s+/).indexOf(c) !== -1; }
    };
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  focus() { this.focused = true; }
  all() { const out = []; (function walk(n) { n.children.forEach((c) => { out.push(c); walk(c); }); })(this); return out; }
  querySelectorAll(sel) { const tags = sel.split(',').map((s) => s.trim()); return this.all().filter((e) => tags.indexOf(e.tagName) !== -1); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get visible() { let n = this; while (n) { if (n.hidden) { return false; } n = n.parent; } return true; }
}
function buildDom(source) {
  const body = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/, '');
  const root = new El('root');
  const stack = [root];
  const re = /<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[4] !== undefined) { const t = m[4].replace(/\s+/g, ' '); if (t.trim()) { stack[stack.length - 1]._text += t; } continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { if (!VOID.has(tag) && stack.length > 1) { stack.pop(); } continue; }
    const attrs = {};
    const ar = /([\w-]+)(?:="([^"]*)"|='([^']*)')?/g;
    let a;
    while ((a = ar.exec(m[3])) !== null) { attrs[a[1]] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : ''); }
    const el = new El(tag, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(tag)) { stack.push(el); }
  }
  return root;
}
const settle = async () => { for (let i = 0; i < 20; i++) { await new Promise((r) => setImmediate(r)); } };
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}
function makeClock() {
  const c = { now: 1760000000000, timers: new Map(), nextId: 1 };
  c.set = (fn, ms, every) => { const id = c.nextId++; c.timers.set(id, { at: c.now + ms, fn, every: every ? ms : 0 }); return id; };
  c.clear = (id) => { c.timers.delete(id); };
  c.advance = async (ms) => {
    const target = c.now + ms;
    await settle();
    for (;;) {
      let best = null;
      for (const [id, t] of c.timers) { if (t.at <= target && (!best || t.at < best.t.at)) { best = { id, t }; } }
      if (!best) { break; }
      c.now = Math.max(c.now, best.t.at);
      if (best.t.every) { best.t.at += best.t.every; } else { c.timers.delete(best.id); }
      best.t.fn();
      await settle();
    }
    c.now = target;
    await settle();
  };
  return c;
}
function fireEl(el, type) {
  const ev = { type, target: el, preventDefault() {}, stopPropagation() {} };
  for (let n = el; n; n = n.parent) {
    if (typeof n['on' + type] === 'function') { n['on' + type](ev); }
    (n.listeners[type] || []).forEach((fn) => fn(ev));
    if (type === 'click' || type === 'change') { break; }
  }
}
// opts: {search, local, session, fetch, noCore, clock}
function boot(opts) {
  const o = opts || {};
  const root = buildDom(html);
  const byId = {};
  root.all().forEach((e) => { if (e.id) { byId[e.id] = e; } });
  const clock = o.clock || makeClock();
  const local = o.local || makeStorage();
  const session = o.session || makeStorage();
  const FDate = class extends Date { constructor(...a) { if (a.length) { super(...a); } else { super(clock.now); } } static now() { return clock.now; } };
  const winListeners = {};
  const doc = {
    getElementById: (id) => byId[id] || null,
    createElement: (t) => new El(t),
    querySelectorAll: (sel) => (sel === '.page' ? root.all().filter((e) => e.classList.contains('page')) : [])
  };
  const win = {
    location: { search: o.search || '', protocol: 'https:', host: 'localhost:8765' }, scrollTo() {}, localStorage: local, sessionStorage: session,
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
  };
  const ctx = {
    window: win, document: doc, console, Date: FDate, Math, JSON, Object, Array, String, Number, Promise, Uint8Array, RegExp, Error, TypeError,
    encodeURIComponent, parseInt, isNaN, setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: clock.clear,
    setInterval: (fn, ms) => clock.set(fn, ms, true), clearInterval: clock.clear,
    crypto: require('node:crypto').webcrypto, fetch: o.fetch, AbortController
  };
  win.window = win; win.document = doc; win.crypto = ctx.crypto;
  vm.createContext(ctx);
  const sre = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = sre.exec(html)) !== null) {
    const src = /src="([^"?]+)/.exec(m[1]);
    if (src) {
      if (o.noCore && src[1] === 'quiz-core.js') { continue; }
      vm.runInContext(fs.readFileSync(path.join(ROOT, src[1]), 'utf8'), ctx, { filename: src[1] });
    } else {
      vm.runInContext(m[2], ctx, { filename: 'index.html' });
    }
  }
  return {
    byId, clock, local, session, win,
    click(el) {
      if (el.disabled) { return; }
      fireEl(el, 'click');
      if (el.tagName === 'button' && el.type === 'submit') { let f = el.parent; while (f && f.tagName !== 'form') { f = f.parent; } if (f) { fireEl(f, 'submit'); } }
    },
    type(el, v) { el.value = v; fireEl(el, 'input'); },
    check(el, v) { el.checked = v; fireEl(el, 'input'); fireEl(el, 'change'); },
    fireWin(type, ev) { (winListeners[type] || []).forEach((fn) => fn(ev)); },
    vis(id) { return byId[id].visible; },
    page() { return ['p-landing', 'p-info', 'p-quiz', 'p-wait', 'p-saving', 'p-error', 'p-ticket'].filter((p) => byId[p].visible); },
    text(id) { return byId[id].textContent; },
    advance: clock.advance
  };
}

// ---- fixtures
const env = (data) => JSON.stringify({ ok: true, apiVersion: 3, serverMs: 5, data });
const errEnv = (code, retryable) => JSON.stringify({ ok: false, apiVersion: 3, serverMs: 5, code, message: 'x', retryable: !!retryable });
const mkTicket = (n, extra) => Object.assign({ ticketId: 'tid-' + n + '-aaaaaaaaaaaaaaaa', ticketToken: 'tok-' + n + '-bbbbbbbbbbbbbbbb', ticketNo: n,
  ticketLabel: 'No. ' + String(n).padStart(3, '0'), eventId: 'a-day-2026', entryType: 'card', issuedAt: '2026-10-14T06:03:00.000Z', issuedLabel: '15:03',
  redeemed: false, redeemedAt: '', redeemedLabel: '' }, extra || {});
const cfgData = (extra) => Object.assign({ eventId: 'a-day-2026', eventName: 'Valen 행운퀴즈', registrationOpen: true, infoPathReady: true, contentVersion: 'v1', contentReady: true,
  questions: [{ id: 'q1', order: 1, type: 'text', title: '서버 질문', hint: '서버힌트', options: [], imageA: '', imageB: '', captionA: '', captionB: '', accepted: ['정답'], correct: '', explanation: '설명입니다' }],
  consent: { version: 'cv1', collectedItems: '수집 항목: 테스트', requiredDetail: '필수 안내', marketingDetail: '', privacyNoticeUrl: '' } }, extra || {});
function fakeFetch(handler) {
  const calls = [];
  const f = (url, init) => {
    calls.push({ url, init });
    let r;
    try { r = handler(url, init, calls); } catch (e) { return Promise.reject(e); }
    return r instanceof Promise ? r : Promise.resolve({ text: () => Promise.resolve(r) });
  };
  f.calls = calls;
  f.posts = (action) => calls.filter((c) => c.init.method === 'POST' && JSON.parse(c.init.body).action === action).map((c) => JSON.parse(c.init.body));
  return f;
}
const STORE_KEY = 'valen-quiz:v3';
function storedState(ticket, extra) {
  return JSON.stringify(Object.assign({ v: 3, savedAt: 1760000000000, eventId: 'a-day-2026', stage: 'ticket', entryType: 'card', answers: {}, qIndex: 0, ticket }, extra || {}));
}
const PIN = '7391';
// Card path up to the saving screen (the question is answered, the ticket button is tapped).
async function cardPathToTicket(h) {
  h.click(h.byId['landing-start']); await settle();
  h.check(h.byId['card-skip'], true); h.click(h.byId['info-next']); await settle();
  h.type(h.byId['q-answer'], '정답'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); await settle();
}

// ============================================================================================ run: F2 flows
test('F2r run: demo card path reaches the ticket with no network call and only demo: keys', async () => {
  const f = fakeFetch(() => { throw new Error('the network must not be touched in demo'); });
  const h = boot({ search: '?demo=1', fetch: f });
  await settle();
  assert.deepStrictEqual(h.page(), ['p-landing']);
  assert.strictEqual(h.vis('demo-badge'), true);
  await cardPathToTicket(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(h.text('ticket-no'), 'No. 001');
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(h.local.map.size, 0, 'the real storage is untouched');
  assert.deepStrictEqual(Array.from(h.session.map.keys()).filter((k) => !k.startsWith('demo:')), []);
});

test('F2r run: the info path blocks without name, phone and consent, with the exact copy', async () => {
  const h = boot({ search: '?demo=1' });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(h.text('info-error'), '이름과 휴대폰 번호를 입력해 주세요.');
  h.type(h.byId['field-name'], '테스트참가자'); h.type(h.byId['field-phone'], '010-0000-0001');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(h.text('info-error'), '개인정보 수집·이용에 동의해야 참여할 수 있어요.');
  h.type(h.byId['field-name'], 'ㄱ'.repeat(41));
  h.check(h.byId['consent-required'], true);
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(h.text('info-error'), '입력한 내용이 너무 길어요. 줄여서 다시 입력해 주세요.');
  h.type(h.byId['field-name'], '테스트참가자');
  h.click(h.byId['info-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-quiz']);
});

test('F2r run: no consent text focuses the card checkbox, and a closed registration is not pre-checked on the landing', async () => {
  const f = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData({ infoPathReady: false, registrationOpen: false })); }
    return errEnv('REGISTRATION_CLOSED', false);
  });
  const h = boot({ fetch: f });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  assert.deepStrictEqual(h.page(), ['p-info'], 'the landing lets the person start whatever the config says');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(h.byId['card-skip'].focused, true);
  assert.strictEqual(h.byId['consent-required'].focused, false);
  h.check(h.byId['card-skip'], true); h.click(h.byId['info-next']); await settle();
  h.type(h.byId['q-answer'], 'a'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-error']);
  assert.strictEqual(h.byId['p-error'].getAttribute('data-error-code'), 'REGISTRATION_CLOSED');
});

test('F2r run: offline saving retries with one body; a manual retry after exhaustion stores the ticket', async () => {
  let online = false;
  const f = fakeFetch((url, init) => {
    if (!online) { throw new TypeError('offline'); }
    return init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(7), repeated: false, existing: '', timing: {} });
  });
  const h = boot({ fetch: f });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  h.check(h.byId['card-skip'], true); h.click(h.byId['info-next']); await settle();
  await h.advance(5100);
  h.type(h.byId['q-answer'], 'x'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); h.byId['q-next'].onclick(); // a second tap in the same tick
  await h.advance(60000);
  const posts = f.posts('submit');
  assert.strictEqual(posts.length, 4, 'four automatic attempts, one request chain');
  assert.ok(posts.every((p) => JSON.stringify(p) === JSON.stringify(posts[0])), 'identical body every attempt');
  assert.deepStrictEqual(h.page(), ['p-saving']);
  assert.strictEqual(h.byId['saving-retry'].hidden, false);
  assert.strictEqual(h.text('saving-text'), "연결이 잠시 불안정해요. 아래 '다시 시도'를 누르거나 부스 스태프에게 이 화면을 보여주세요.");
  online = true;
  h.click(h.byId['saving-retry']); await settle();
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(f.posts('submit').pop().requestId, posts[0].requestId, 'same requestId');
  assert.ok(JSON.parse(h.local.map.get(STORE_KEY)).ticket, 'the ticket is stored');
});

test('F2r run: the saving text is written only when it changes; a locked answer is read-only', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  h.check(h.byId['card-skip'], true); h.click(h.byId['info-next']); await settle();
  h.type(h.byId['q-answer'], 'a'); h.click(h.byId['q-confirm']); await settle();
  assert.strictEqual(h.byId['q-answer'].readOnly, true);
  assert.strictEqual(h.byId['q-answer'].disabled, false);
  let writes = 0;
  const el = h.byId['saving-text'];
  Object.defineProperty(el, 'textContent', { set(v) { writes += 1; this._text = String(v); }, get() { return this._text; } });
  h.click(h.byId['q-next']); await settle();
  await h.advance(12000); // twelve one-second ticks: the first text and the 8 s "slow" text only
  assert.ok(writes <= 2, 'the text was written ' + writes + ' times');
  assert.strictEqual(h.text('saving-text'), '사람이 많아 조금 걸리고 있어요. 이 화면을 닫지 말고 기다려 주세요.');
});

// ============================================================================================ run: F3
test('F3r run: the clock ticks every second and a redeemed demo ticket stays used after a reload', async () => {
  const clock = makeClock();
  const session = makeStorage();
  const h = boot({ search: '?demo=1', session, clock });
  await settle();
  await cardPathToTicket(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.ok(/^지금 \d\d:\d\d:\d\d$/.test(h.text('ticket-clock')));
  const t0 = h.text('ticket-clock');
  await clock.advance(1000);
  assert.notStrictEqual(h.text('ticket-clock'), t0, 'the clock moved after one second');
  assert.strictEqual(h.text('ticket-demo'), '미리보기 (사용 불가)');
  assert.strictEqual(h.text('ticket-status'), '스태프에게 이 화면을 보여주세요');
  h.click(h.byId['staff-toggle']);
  assert.strictEqual(h.byId['staff-panel'].hidden, false);
  h.type(h.byId['staff-pin'], PIN); h.click(h.byId['staff-redeem']); await settle();
  assert.strictEqual(h.text('staff-result'), '미리보기 (사용 불가)', 'a preview ticket never says to spin');
  assert.ok(h.byId['staff-result'].className.indexOf('bad') !== -1 && h.byId['staff-result'].className.indexOf('ok') === -1);
  assert.strictEqual(h.byId['staff-pin'].value, '', 'the PIN field is cleared');
  assert.ok(/^룰렛 참여 완료 \(\d\d:\d\d\)$/.test(h.text('ticket-status')));
  assert.ok(h.byId['ticket-slot'].classList.contains('used'));
  h.type(h.byId['staff-pin'], PIN); h.click(h.byId['staff-redeem']); await settle();
  assert.strictEqual(h.text('staff-result'), '미리보기 (사용 불가)');
  // reload: the same session storage, a fresh page
  const h2 = boot({ search: '?demo=1', session, clock });
  await settle();
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
  assert.ok(/^룰렛 참여 완료/.test(h2.text('ticket-status')), 'still used after the reload (checked locally)');
  const all = JSON.stringify(Array.from(session.map.entries()));
  assert.ok(all.indexOf(PIN) === -1, 'the PIN is never stored');
  // an unused preview ticket can still be redeemed after a reload
  const h3 = boot({ search: '?demo=1', session: makeStorage({ 'demo:valen-quiz:v3': storedState(mkTicket(5, { demo: true, eventId: 'demo-preview' }), { eventId: 'demo-preview' }) }), clock });
  await settle();
  h3.type(h3.byId['staff-pin'], PIN); h3.click(h3.byId['staff-redeem']); await settle();
  assert.strictEqual(h3.text('staff-result'), '미리보기 (사용 불가)');
  assert.ok(/^룰렛 참여 완료 \(\d\d:\d\d\)$/.test(h3.text('ticket-status')), 'the preview ticket is still marked used locally');
});

test('F3r run: the redeem requestId persists across re-taps until a definitive answer; the PIN is cleared and never stored', async () => {
  let failing = true;
  const f = fakeFetch((url, init) => {
    const b = init.method === 'POST' ? JSON.parse(init.body) : {};
    if (init.method === 'GET') { return env(cfgData()); }
    if (b.action === 'ticket') { return env({ ticket: mkTicket(3) }); }
    if (failing) { throw new TypeError('offline'); }
    const prior = f.posts('redeem').filter((x) => x.requestId !== b.requestId).length;
    const first = f.posts('redeem')[0].requestId;
    return prior === 0 || b.requestId === first
      ? env({ status: 'REDEEMED', ticket: mkTicket(3, { redeemed: true, redeemedAt: '2026-10-14T06:10:00.000Z', redeemedLabel: '15:10' }), timing: {} })
      : env({ status: 'ALREADY_REDEEMED', ticket: mkTicket(3, { redeemed: true, redeemedAt: '2026-10-14T06:10:00.000Z', redeemedLabel: '15:10' }), timing: {} });
  });
  const local = makeStorage({ [STORE_KEY]: storedState(mkTicket(3)) });
  const h = boot({ fetch: f, local });
  await settle();
  h.click(h.byId['staff-toggle']);
  h.type(h.byId['staff-pin'], '12'); h.click(h.byId['staff-redeem']); await settle();
  assert.strictEqual(h.text('staff-result'), '확인 번호가 맞지 않아요.');
  assert.strictEqual(f.posts('redeem').length, 0, 'a PIN of the wrong length is not sent');
  h.type(h.byId['staff-pin'], PIN); h.click(h.byId['staff-redeem']);
  assert.strictEqual(h.byId['staff-pin'].value, '', 'cleared at once');
  await h.advance(100);
  assert.strictEqual(h.text('staff-result'), '연결이 잠시 불안정해요. 자동으로 다시 시도할게요.', 'the K1 retry copy during the backoff');
  await h.advance(20000);
  assert.strictEqual(f.posts('redeem').length, 3, 'three automatic attempts');
  assert.strictEqual(h.byId['staff-redeem'].disabled, false, 'the staff can tap again');
  assert.strictEqual(h.text('staff-result'), "연결이 불안정해요. '룰렛 완료 처리'를 다시 눌러 주세요.", 'after the last attempt: what to do');
  failing = false;
  h.type(h.byId['staff-pin'], PIN); h.click(h.byId['staff-redeem']); await settle();
  const ids = f.posts('redeem').map((p) => p.requestId);
  assert.strictEqual(new Set(ids).size, 1, 'the same requestId on every attempt and re-tap: ' + ids.join(','));
  assert.strictEqual(h.text('staff-result'), '처리 완료. 룰렛을 돌려 주세요');
  assert.ok(h.byId['staff-result'].className.indexOf('ok') !== -1);
  assert.ok(h.byId['ticket-slot'].classList.contains('used'));
  // a new tap after the final answer is a new request
  h.type(h.byId['staff-pin'], PIN); h.click(h.byId['staff-redeem']); await settle();
  const ids2 = f.posts('redeem').map((p) => p.requestId);
  assert.notStrictEqual(ids2[ids2.length - 1], ids[0], 'a new requestId after a definitive answer');
  assert.ok(/^이미 사용된 응모권이에요 \(15:10\)\./.test(h.text('staff-result')));
  assert.ok(JSON.stringify(Array.from(local.map.entries())).indexOf(PIN) === -1, 'the PIN is never stored');
  assert.ok(f.calls.every((c) => c.url.indexOf(PIN) === -1), 'the PIN is never in a URL');
});

test('F3r run: reload shows the stored status first; used never goes back to unused; not found and unreachable states', async () => {
  const used = mkTicket(4, { redeemed: true, redeemedAt: '2026-10-14T06:10:00.000Z', redeemedLabel: '15:10' });
  // 1. a slow answer that says "unused" must not downgrade a used ticket
  let release;
  const slow = new Promise((resolve) => { release = () => resolve({ text: () => Promise.resolve(env({ ticket: mkTicket(4) })) }); });
  const f1 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : slow));
  const local1 = makeStorage({ [STORE_KEY]: storedState(used) });
  const h1 = boot({ fetch: f1, local: local1 });
  await settle();
  assert.strictEqual(h1.text('ticket-status'), '확인 중');
  assert.ok(h1.byId['ticket-slot'].classList.contains('used'), 'the stored used state shows while checking');
  release(); await settle();
  assert.strictEqual(h1.text('ticket-status'), '룰렛 참여 완료 (15:10)');
  assert.strictEqual(JSON.parse(local1.map.get(STORE_KEY)).ticket.redeemed, true);
  assert.strictEqual(f1.posts('ticket').length, 1, 'exactly one status call');
  // 2. TICKET_NOT_FOUND
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : errEnv('TICKET_NOT_FOUND', false)));
  const h2 = boot({ fetch: f2, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(4)) }) });
  await settle();
  assert.strictEqual(h2.text('ticket-status'), '확인 불가');
  // 3. unreachable: the stored status plus a recheck link, which asks again
  let online = false;
  const f3 = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData()); }
    if (!online) { throw new TypeError('offline'); }
    return env({ ticket: used });
  });
  const h3 = boot({ fetch: f3, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(4)) }) });
  await settle(); await h3.advance(5000);
  assert.strictEqual(h3.text('ticket-status'), '스태프에게 이 화면을 보여주세요');
  assert.strictEqual(h3.byId['ticket-recheck'].hidden, false);
  assert.strictEqual(h3.text('ticket-recheck'), '상태 다시 확인');
  online = true;
  h3.click(h3.byId['ticket-recheck']); await settle();
  assert.strictEqual(h3.text('ticket-status'), '룰렛 참여 완료 (15:10)');
  assert.strictEqual(h3.byId['ticket-recheck'].hidden, true);
  // 4. a config for another event clears the stored ticket and returns to the landing
  const f4 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ eventId: 'phonetest-1012' })) : env({ ticket: mkTicket(4) })));
  const h4 = boot({ fetch: f4, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(4)) }) });
  await settle();
  assert.deepStrictEqual(h4.page(), ['p-landing']);
});

test('F3r run: TICKET_NOT_FOUND from a redeem shows 확인 불가; a redeem answer after the page moved on is ignored; a config reset clears the staff panel', async () => {
  // r4
  const f1 = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData()); }
    return JSON.parse(init.body).action === 'ticket' ? env({ ticket: mkTicket(8) }) : errEnv('TICKET_NOT_FOUND', false);
  });
  const h1 = boot({ fetch: f1, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(8)) }) });
  await settle();
  h1.click(h1.byId['staff-toggle']);
  h1.type(h1.byId['staff-pin'], PIN); h1.click(h1.byId['staff-redeem']); await settle();
  assert.strictEqual(h1.text('staff-result'), '응모권을 확인할 수 없어요. 부스 스태프에게 이 화면을 보여주세요.');
  assert.strictEqual(h1.text('ticket-status'), '확인 불가');
  // r2 and r3: the redeem answer arrives after a config for another event reset the page
  let release;
  const slow = new Promise((resolve) => { release = () => resolve({ text: () => Promise.resolve(env({ status: 'REDEEMED', ticket: mkTicket(9, { redeemed: true, redeemedLabel: '15:10' }), timing: {} })) }); });
  let cfgRelease;
  const slowCfg = new Promise((resolve) => { cfgRelease = () => resolve({ text: () => Promise.resolve(env(cfgData({ eventId: 'phonetest-1012' }))) }); });
  const f2 = fakeFetch((url, init) => {
    if (init.method === 'GET') { return slowCfg; }
    return JSON.parse(init.body).action === 'ticket' ? env({ ticket: mkTicket(9) }) : slow;
  });
  const local2 = makeStorage({ [STORE_KEY]: storedState(mkTicket(9)) });
  const h2 = boot({ fetch: f2, local: local2 });
  await settle();
  h2.click(h2.byId['staff-toggle']);
  h2.type(h2.byId['staff-pin'], PIN); h2.click(h2.byId['staff-redeem']); await settle();
  cfgRelease(); await settle(); // the other event resets the page while the redeem is in flight
  assert.deepStrictEqual(h2.page(), ['p-landing']);
  release(); await settle();
  assert.strictEqual(h2.text('staff-result'), '', 'a late redeem answer does not write into the new page');
  assert.ok(!JSON.parse(local2.map.get(STORE_KEY) || '{}').ticket, 'the old ticket was not written back');
  // r3: a result that is on screen when the config resets the page is cleared and the panel is closed
  let cfgRelease3;
  const slowCfg3 = new Promise((resolve) => { cfgRelease3 = () => resolve({ text: () => Promise.resolve(env(cfgData({ eventId: 'phonetest-1012' }))) }); });
  const f3 = fakeFetch((url, init) => (init.method === 'GET' ? slowCfg3 : env({ ticket: mkTicket(10) })));
  const h3 = boot({ fetch: f3, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(10)) }) });
  await settle();
  h3.click(h3.byId['staff-toggle']);
  h3.type(h3.byId['staff-pin'], '12'); h3.click(h3.byId['staff-redeem']); await settle();
  assert.strictEqual(h3.text('staff-result'), '확인 번호가 맞지 않아요.', 'a result is on screen before the reset');
  cfgRelease3(); await settle();
  assert.deepStrictEqual(h3.page(), ['p-landing']);
  assert.strictEqual(h3.byId['staff-panel'].hidden, true, 'the staff panel is closed');
  assert.strictEqual(h3.byId['staff-toggle'].getAttribute('aria-expanded'), 'false');
  assert.strictEqual(h3.text('staff-result'), '');
});

// ============================================================================================ run: Codex review (C24)
const DEVICE_KEY = 'valen-quiz:device';
const DEVICE_ID = 'dev-0000-aaaa-bbbb-cccc';
function pendingState(extra) {
  const body = { action: 'submit', apiVersion: 3, requestId: 'req-pending-aaaaaaaa', deviceId: DEVICE_ID, entryType: 'card', info: null, consent: null,
    contentVersion: 'v1', answers: [{ questionId: 'q1', value: '정답' }], build: DEFAULTS.build };
  return JSON.stringify(Object.assign({ v: 3, savedAt: 1760000000000, eventId: 'a-day-2026', stage: 'saving', entryType: 'card', answers: { q1: '정답' }, qIndex: 0,
    pending: { requestId: body.requestId, body } }, extra || {}));
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve: (text) => resolve({ text: () => Promise.resolve(text) }) };
}

test('F2r run: a stored pending request waits for config and is not replayed into another event', async () => {
  // another event: no replay, landing, the stored state is gone, the device id stays
  const fA = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ eventId: 'phonetest-1012' })) : env({ ticket: mkTicket(1) })));
  const localA = makeStorage({ [STORE_KEY]: pendingState(), [DEVICE_KEY]: DEVICE_ID });
  const hA = boot({ fetch: fA, local: localA });
  await settle();
  assert.strictEqual(fA.posts('submit').length, 0, 'no replay into another event');
  assert.deepStrictEqual(hA.page(), ['p-landing']);
  assert.strictEqual(localA.map.has(STORE_KEY), false);
  assert.strictEqual(localA.map.get(DEVICE_KEY), DEVICE_ID);
  // slow config: nothing is sent while it is awaited; the same event then replays with the same requestId
  const cfgD = deferred();
  const fB = fakeFetch((url, init) => (init.method === 'GET' ? cfgD.promise : env({ ticket: mkTicket(2), repeated: true, existing: '', timing: {} })));
  const hB = boot({ fetch: fB, local: makeStorage({ [STORE_KEY]: pendingState(), [DEVICE_KEY]: DEVICE_ID }) });
  await settle();
  assert.strictEqual(fB.posts('submit').length, 0, 'waiting for config');
  assert.deepStrictEqual(hB.page(), ['p-wait']);
  cfgD.resolve(env(cfgData())); await settle();
  assert.strictEqual(fB.posts('submit').length, 1);
  assert.strictEqual(fB.posts('submit')[0].requestId, 'req-pending-aaaaaaaa');
  assert.deepStrictEqual(hB.page(), ['p-ticket']);
  // config never arrives: after the 5 s wait the replay goes ahead (accepted residual)
  const fC = fakeFetch((url, init) => (init.method === 'GET' ? new Promise(() => {}) : env({ ticket: mkTicket(3), repeated: true, existing: '', timing: {} })));
  const hC = boot({ fetch: fC, local: makeStorage({ [STORE_KEY]: pendingState(), [DEVICE_KEY]: DEVICE_ID }) });
  await settle();
  assert.strictEqual(fC.posts('submit').length, 0);
  await hC.advance(5100);
  assert.strictEqual(fC.posts('submit').length, 1);
  assert.deepStrictEqual(hC.page(), ['p-ticket']);
});

test('F2r run: a config for another event that arrives while saving wins over the returned ticket', async () => {
  const cfgD = deferred();
  const postD = deferred();
  const f = fakeFetch((url, init) => (init.method === 'GET' ? cfgD.promise : postD.promise));
  const local = makeStorage({ [DEVICE_KEY]: DEVICE_ID });
  const h = boot({ fetch: f, local });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  h.check(h.byId['card-skip'], true); h.click(h.byId['info-next']); await settle();
  await h.advance(5100); // config still pending: the embedded question
  h.type(h.byId['q-answer'], 'x'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-saving']);
  cfgD.resolve(env(cfgData({ eventId: 'phonetest-1012' }))); await settle(); // config B while saving
  assert.deepStrictEqual(h.page(), ['p-saving'], 'config does not interrupt the request in flight');
  postD.resolve(env({ ticket: mkTicket(5), repeated: false, existing: '', timing: {} })); await settle(); // ticket of event A
  assert.deepStrictEqual(h.page(), ['p-landing'], 'a ticket of another event is not shown');
  assert.strictEqual(h.text('ticket-no'), '');
  assert.strictEqual(local.map.has(STORE_KEY), false, 'and not stored');
  assert.strictEqual(local.map.get(DEVICE_KEY), DEVICE_ID);
  // the same event: the ticket is shown
  const cfgE = deferred();
  const postE = deferred();
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? cfgE.promise : postE.promise));
  const h2 = boot({ fetch: f2 });
  await settle();
  h2.click(h2.byId['landing-start']); await settle();
  h2.check(h2.byId['card-skip'], true); h2.click(h2.byId['info-next']); await settle();
  await h2.advance(5100);
  h2.type(h2.byId['q-answer'], 'x'); h2.click(h2.byId['q-confirm']); await settle();
  h2.click(h2.byId['q-next']); await settle();
  cfgE.resolve(env(cfgData())); await settle();
  postE.resolve(env({ ticket: mkTicket(6), repeated: false, existing: '', timing: {} })); await settle();
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
});

test('F2r run: a success without a valid ticket is retried and never shown; the pending body is kept', async () => {
  // {"ticket":{}} on every attempt
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : '{"ok":true,"apiVersion":3,"data":{"ticket":{}}}'));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await cardPathToTicket(h);
  await h.advance(60000);
  const posts = f.posts('submit');
  assert.strictEqual(posts.length, 4, 'four automatic attempts');
  assert.ok(posts.every((p) => JSON.stringify(p) === JSON.stringify(posts[0])));
  assert.deepStrictEqual(h.page(), ['p-saving']);
  assert.strictEqual(h.byId['saving-retry'].hidden, false);
  assert.strictEqual(h.text('ticket-no'), '');
  const saved = JSON.parse(local.map.get(STORE_KEY));
  assert.strictEqual(saved.ticket, undefined);
  assert.strictEqual(saved.pending.requestId, posts[0].requestId, 'pending kept with its exact body');
  // {"data":{}} is retried automatically inside the loop and the second, valid answer is shown
  let n = 0;
  const f2 = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData()); }
    n += 1;
    return n === 1 ? '{"ok":true,"apiVersion":3,"data":{}}' : env({ ticket: mkTicket(4), repeated: false, existing: '', timing: {} });
  });
  const h2 = boot({ fetch: f2 });
  await settle();
  await cardPathToTicket(h2);
  await h2.advance(5000);
  assert.strictEqual(n, 2, 'retried automatically within the loop, without a tap');
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
  assert.strictEqual(h2.text('ticket-no'), 'No. 004');
});

test('F2r run: the info inputs are empty and the saving state is released once a valid ticket is shown', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(7, { entryType: 'info' }), repeated: false, existing: '', timing: {} })));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  h.click(h.byId['landing-start']); await settle();
  h.type(h.byId['field-name'], '테스트참가자'); h.type(h.byId['field-org'], '테스트회사');
  h.type(h.byId['field-phone'], '010-0000-0007'); h.type(h.byId['field-email'], 'test@example.com');
  h.check(h.byId['consent-required'], true);
  h.click(h.byId['info-next']); await settle();
  h.type(h.byId['q-answer'], '정답'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(f.posts('submit')[0].info.name, '테스트참가자', 'the request carried the info');
  ['field-name', 'field-org', 'field-phone', 'field-email'].forEach((id) => assert.strictEqual(h.byId[id].value, '', id + ' is emptied'));
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).info, undefined);
});

test('F2r run: a throwing async callback shows the boot card and keeps a valid ticket visible', async () => {
  let release;
  const slow = new Promise((resolve) => { release = () => resolve({ text: () => Promise.resolve(env({ ticket: mkTicket(6) })) }); });
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : slow));
  const h = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(6)) }) });
  await settle();
  assert.strictEqual(h.vis('boot-card'), false);
  Object.defineProperty(h.byId['ticket-status'], 'textContent', { set() { throw new Error('draw failed'); }, get() { return ''; } });
  release(); await settle();
  assert.strictEqual(h.vis('boot-card'), true);
  assert.strictEqual(h.vis('p-ticket'), true, 'the ticket stays visible');
  // the global handlers: an own error shows the card, foreign errors do not
  const h2 = boot({ search: '?demo=1' });
  await settle();
  h2.fireWin('error', { message: 'Script error.', filename: '' });
  h2.fireWin('error', { message: 'boom', filename: 'chrome-extension://abc/x.js' });
  assert.strictEqual(h2.vis('boot-card'), false);
  h2.fireWin('error', { message: 'boom', filename: 'https://localhost:8765/index.html' });
  assert.strictEqual(h2.vis('boot-card'), true);
  assert.deepStrictEqual(h2.page(), []);
  const h3 = boot({ noCore: true });
  assert.strictEqual(h3.vis('boot-card'), true, 'a missing QuizCore ends in the message, not a blank page');
});
