'use strict';
/*
 * Tests of index.html (slices F2, F3 and the C28 update: intro screen, no ticket box or staff panel).
 * Static checks read the page as text and compile its inline scripts with node:vm.
 * "run" tests execute the real page scripts against a small hand-written fake DOM (no browser, no jsdom,
 * no network): a fake fetch, a fake clock and an in-memory storage are injected.
 * Run: node --test test/page.test.js
 * Fixtures use fake values only (phones 010-0000-xxxx, name 테스트참가자).
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
  const hooks = ['field-name', 'field-org', 'field-phone', 'field-email', 'consent-required', 'info-next', 'intro-start',
    'concern-option', 'concern-next', 'q-title', 'q-hint', 'q-answer', 'q-next', 'saving-root', 'saving-retry', 'error-card'];
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
  // No PIN value and no staff code path exist on this page any more.
  assert.strictEqual(html.indexOf('246810'), -1);
  assert.ok(!/staff|redeem|checkTicket|api\.ticket|demoRedeem|finishRedeem|clockTimer|setInterval\(guard\(tickClock/i.test(html), 'no staff, redeem or ticket-status code is left');
});

test('F2 page: the first screen carries the team title, fields, consent text and footnote verbatim', () => {
  const m = markup.match(/<section[^>]*id="p-info"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(m, 'info section missing');
  const info = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  [
    'Valen Lucky Quiz', '이름', '이메일', '연락처', '소속 (회사명·직책)', '(필수) 개인정보 수집·이용에 동의합니다', '펼쳐보기', '다음으로',
    '입력해주신 정보는 명함 응모와 동일하게 처리됩니다. 이벤트 참여 및 경품 추첨에 활용됩니다.'
  ].forEach((t) => assert.ok(info.includes(t), 'the first screen is missing: ' + t));
  assert.ok(!/card-skip|명함을 명함함에/.test(markup), 'the card path is gone');
  assert.ok(!/consent-marketing|마케팅/.test(markup), 'no marketing checkbox');
  assert.ok(/<title>Valen Lucky Quiz<\/title>/.test(html));
  // the concern step and the quiz screen use the team copy
  ['당신의 브랜드 또는 제품의 고민을 선택해주세요.', '(중복체크 가능)', '오후 5시, session3, 첫번째 강연에서 해결책을 제시해드립니다', '힌트 :', '참여 완료']
    .forEach((t) => assert.ok(markup.includes(t), 'missing: ' + t));
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
  assert.ok(ids.size > 30, 'expected the page to bind many ids, found ' + ids.size);
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
  assert.ok(/<meta name="color-scheme" content="light">/.test(html), 'the page is light now');
});

test('F2r page: boot copy, phone input and answer input attributes are pinned', () => {
  assert.ok(/<section[^>]*id="boot-card"[^>]*>\s*<p>잠시 후 새로고침해 주세요\. 계속 안 되면 부스 스태프에게 말씀해 주세요\.<\/p>/.test(markup));
  const phone = markup.match(/<input[^>]*data-testid="field-phone"[^>]*>/)[0];
  ['type="tel"', 'inputmode="numeric"', 'placeholder="010-1234-5678"'].forEach((a) => assert.ok(phone.indexOf(a) !== -1, 'phone input needs ' + a));
  const answer = markup.match(/<input[^>]*data-testid="q-answer"[^>]*>/)[0];
  ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'placeholder="정답을 입력해 주세요"'].forEach((a) => assert.ok(answer.indexOf(a) !== -1, 'answer input needs ' + a));
  // The collected-items line of the server config is never rendered (the team text has its own).
  assert.ok(!/consent-items|\.collectedItems/.test(app), 'the page does not render collectedItems');
});

test('F2r page: async callbacks are guarded and both global error handlers are registered', () => {
  assert.ok(/addEventListener\('error'/.test(scripts[0]));
  // In-app browsers inject unhandled rejections of their own, so only the error event is listened to.
  assert.ok(!/unhandledrejection/.test(scripts[0] + app));
  // Every promise callback that touches the page goes through guard(), whether it is inline or a named function.
  const thens = app.split('.then(').slice(1);
  assert.ok(thens.length >= 2, 'expected to find the promise callbacks');
  thens.forEach((t) => assert.ok(t.startsWith('guard('), 'a .then callback is not wrapped in guard(): .then(' + t.slice(0, 30)));
});

// ============================================================================================ static: C28
function squash(fragment) { return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function section(id) {
  const m = markup.match(new RegExp('<section[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</section>'));
  assert.ok(m, 'section ' + id + ' missing');
  return m[1];
}

test('C28 page: the intro screen carries the team copy verbatim, has no page header and a start button', () => {
  const intro = section('p-intro');
  const text = squash(intro);
  ['딱 2문항이면 끝나요.', '1 요즘 가장 가까운 고민 고르기', '2 빈칸에 들어갈 단어 맞히기', '힌트가 있어서 어렵지 않아요 · 30초 소요', '시작하기']
    .forEach((t) => assert.ok(text.includes(t), 'the intro is missing: ' + t));
  assert.ok(!/<h1/.test(intro), 'no page header on the intro');
  assert.ok(!text.includes('Valen Lucky Quiz'));
  assert.ok(/<h2>딱 2문항이면 끝나요\.<\/h2>/.test(intro), 'the larger bold line is the heading');
  assert.ok(/<button[^>]*id="intro-start"[^>]*data-testid="intro-start"[^>]*>시작하기<\/button>/.test(intro));
  assert.ok(/<span class="num">1<\/span>/.test(intro) && /<span class="num">2<\/span>/.test(intro), 'the numbers are visually distinct');
  // white page, all text #091550, centered
  const rule = html.match(/\.intro \{[^}]*\}/)[0];
  assert.ok(rule.indexOf('color: #091550') !== -1 && rule.indexOf('text-align: center') !== -1, rule);
  assert.ok(!/\.intro[^{]*\{[^}]*(background|color): *#(?!091550|fff)/i.test(html), 'no other text color on the intro');
  const num = html.match(/\.intro \.num \{[^}]*\}/)[0];
  assert.ok(/[^-]color: #091550/.test(num) && !/color: #fff/i.test(num), 'the step numbers are #091550 text, not white: ' + num);
  assert.ok(/--page: #ffffff/.test(html), 'the page background is white');
  // the middle dot of the team line is the team's own; no other visible copy of ours uses it
  assert.strictEqual((text.match(/·/g) || []).length, 1);
});

test('C28 page: the concern heading changed and its text is centered except the option rows; the quiz block is centered', () => {
  const concern = section('p-concern');
  assert.ok(/<h2>당신의 브랜드 또는 제품의 고민을 선택해주세요\.<\/h2>/.test(concern));
  assert.ok(!concern.includes('지금 가장 가까운 상황을'));
  assert.ok(/\.concern \{ text-align: center; \}/.test(html));
  assert.ok(/\.concern label \{ text-align: left;/.test(html), 'the option rows stay left-aligned');
  assert.ok(/#p-quiz \{ text-align: center; \}/.test(html));
  assert.ok(/\.text-answer \{[^}]*text-align: center/.test(html), 'the answer input is centered');
  // order of the screens in the markup: info, intro, concern, quiz
  const order = ['p-info', 'p-intro', 'p-concern', 'p-quiz'].map((id) => markup.indexOf('id="' + id + '"'));
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
});

test('C28 page: the final screen has only the pill, gift, thanks, show-the-screen line and logo; no ticket, clock or staff elements', () => {
  const done = section('p-ticket');
  const text = squash(done);
  assert.strictEqual(text, 'Lucky Quiz 참여해주셔서 감사합니다 담당자에게 이 화면을 보여주세요');
  assert.ok(/<p class="show">담당자에게<br>이 화면을 보여주세요<\/p>/.test(done));
  assert.ok(/<img class="gift" src="assets\/gift\.webp" alt="" width="720" height="720">/.test(done));
  assert.ok(/<img class="logo" src="assets\/valen-logo\.webp" alt="valen" width="400" height="120">/.test(done));
  ['ticket-no', 'ticket-issued', 'ticket-status', 'ticket-clock', 'ticket-recheck', 'ticket-note', 'ticket-demo', 'staff', 'tbox', 'PIN', 'redeem', '응모권'].forEach((n) => {
    assert.strictEqual(markup.indexOf(n), -1, 'markup still has: ' + n);
  });
  ['staff-toggle', 'staff-panel', 'staff-pin', 'staff-redeem', 'staff-result', 'ticket-clock', 'tickClock', 'paintTicket', 'ticketViewModel', 'applyServerTicket'].forEach((n) => {
    assert.strictEqual(html.indexOf(n), -1, 'the page still has: ' + n);
  });
  assert.ok(/id="demo-badge"[^>]*>미리보기<\/span>/.test(markup), 'the preview badge stays');
  assert.ok(/body\.done \{ background: linear-gradient/.test(html), 'the gradient stays');
  // On a 375px phone the 331px column makes the 720px square gift 72% = 238px wide (capped at 300px on wide screens).
  assert.ok(/\.ticket \.gift \{ width: 72%; max-width: 300px;/.test(html));
});

test('C28 page: assets are the new transparent WebP files with the declared sizes; build id and ?v= are 2026-10-12.2', () => {
  function webpInfo(file) {
    const b = fs.readFileSync(path.join(ROOT, 'assets', file));
    assert.strictEqual(b.toString('latin1', 0, 4), 'RIFF');
    assert.strictEqual(b.toString('latin1', 8, 12), 'WEBP');
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8X') { return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1, alpha: (b[20] & 0x10) !== 0 }; }
    assert.strictEqual(kind, 'VP8L');
    const v = b.readUInt32LE(21);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, alpha: ((v >> 28) & 1) === 1 };
  }
  assert.deepStrictEqual(webpInfo('gift.webp'), { w: 720, h: 720, alpha: true });
  assert.deepStrictEqual(webpInfo('valen-logo.webp'), { w: 400, h: 120, alpha: true });
  assert.strictEqual(DEFAULTS.build, '2026-10-12.2');
  assert.ok(html.includes('<script src="defaults.js?v=2026-10-12.2"></script>') && html.includes('<script src="quiz-core.js?v=2026-10-12.2"></script>'));
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
  get parentNode() { return this.parent; }
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
  const writes = []; // every value ever written, in order
  return { map, writes, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { writes.push(String(v)); map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
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
  const body = new El('body');
  const doc = {
    body,
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
    byId, clock, local, session, win, body,
    click(el) {
      if (el.disabled) { return; }
      fireEl(el, 'click');
      if (el.tagName === 'button' && el.type === 'submit') { let f = el.parent; while (f && f.tagName !== 'form') { f = f.parent; } if (f) { fireEl(f, 'submit'); } }
    },
    type(el, v) { el.value = v; fireEl(el, 'input'); },
    check(el, v) { el.checked = v; fireEl(el, 'input'); fireEl(el, 'change'); },
    fireWin(type, ev) { (winListeners[type] || []).forEach((fn) => fn(ev)); },
    vis(id) { return byId[id].visible; },
    page() { return ['p-info', 'p-intro', 'p-concern', 'p-concern-note', 'p-quiz', 'p-quiz-note', 'p-wait', 'p-saving', 'p-error', 'p-ticket'].filter((p) => byId[p].visible); },
    text(id) { return byId[id].textContent; },
    advance: clock.advance
  };
}

// ---- fixtures
const env = (data) => JSON.stringify({ ok: true, apiVersion: 3, serverMs: 5, data });
const errEnv = (code, retryable) => JSON.stringify({ ok: false, apiVersion: 3, serverMs: 5, code, message: 'x', retryable: !!retryable });
const mkTicket = (n, extra) => Object.assign({ ticketId: 'tid-' + n + '-aaaaaaaaaaaaaaaa', ticketToken: 'tok-' + n + '-bbbbbbbbbbbbbbbb', ticketNo: n,
  ticketLabel: 'No. ' + String(n).padStart(3, '0'), eventId: 'a-day-2026', entryType: 'info', issuedAt: '2026-10-14T06:03:00.000Z', issuedLabel: '15:03',
  redeemed: false, redeemedAt: '', redeemedLabel: '' }, extra || {});
// The live server config carries its own collectedItems line (Api.gs); the page must never show it.
const LIVE_COLLECTED = '수집 항목: 이름, 휴대폰 번호, 소속(입력한 경우), 이메일(입력한 경우), 퀴즈 응답, 기기 식별값(중복 참여 방지용)';
const cfgData = (extra) => Object.assign({ eventId: 'a-day-2026', eventName: 'Valen 행운퀴즈', registrationOpen: true, infoPathReady: true, contentVersion: 'v1', contentReady: true,
  questions: [{ id: 'q1', order: 1, type: 'text', title: '서버 질문', hint: '서버힌트', options: [], imageA: '', imageB: '', captionA: '', captionB: '', accepted: ['정답'], correct: '', explanation: '설명입니다' }],
  consent: { version: 'cv1', collectedItems: LIVE_COLLECTED, requiredDetail: '서버 동의 안내', marketingDetail: '', privacyNoticeUrl: '' } }, extra || {});
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
  return JSON.stringify(Object.assign({ v: 3, savedAt: 1760000000000, eventId: 'a-day-2026', stage: 'ticket', entryType: 'info', answers: {}, qIndex: 0, ticket }, extra || {}));
}
const TEAM_CONSENT = [
  '- 수집 항목 : 이름, 연락처, 이메일, 회사명·직책, 고민 유형, 기기 식별값(중복 참여 방지용)',
  '- 이용 목적 이벤트 운영(참여 확인·경품 추첨)',
  '- 보유 기간 수집일로부터 1년 (목적 달성 시 지체 없이 파기)',
  '- 귀하는 개인정보 수집 및 이용에 대한 동의를 거부할 권리가 있습니다. 단, 필수 항목 동의 거부 시 이벤트 참여 및 경품 수령이 제한됩니다.'
];
// ---- flow helpers (the first screen is the info form; then the concern step; then the quiz)
async function fillInfo(h, over) {
  const v = Object.assign({ name: '테스트참가자', email: 'test@example.com', phone: '010-0000-0001', org: '테스트회사 대리' }, over || {});
  h.type(h.byId['field-name'], v.name); h.type(h.byId['field-email'], v.email);
  h.type(h.byId['field-phone'], v.phone); h.type(h.byId['field-org'], v.org);
  h.check(h.byId['consent-required'], true);
  h.click(h.byId['info-next']); await settle();
}
const concernBoxes = (h) => h.byId['p-concern'].querySelectorAll('input');
// The intro screen sits between the info form and the concern step; pressing its button is part of "going on".
async function startIntro(h) { h.click(h.byId['intro-start']); await settle(); }
// Picks at the concern step and presses its button: the concern note screen follows.
async function pickConcernOnly(h, indexes) {
  if (h.vis('p-intro')) { await startIntro(h); }
  indexes.forEach((i) => h.check(concernBoxes(h)[i], true));
  h.click(h.byId['concern-next']); await settle();
}
// Picks, then goes through the concern note screen to the quiz.
async function pickConcern(h, indexes) {
  await pickConcernOnly(h, indexes);
  h.click(h.byId['concern-note-next']); await settle();
}
async function answerQuiz(h, text) {
  h.type(h.byId['q-answer'], text || '정답'); h.click(h.byId['q-confirm']); await settle();
  h.click(h.byId['q-next']); await settle();
}
async function flowToSaving(h) { await fillInfo(h); await pickConcern(h, [0]); await answerQuiz(h); }

// ============================================================================================ run: F2 flows
test('F2r run: the demo flow reaches the final screen with no network call and only demo: keys', async () => {
  const f = fakeFetch(() => { throw new Error('the network must not be touched in demo'); });
  const h = boot({ search: '?demo=1', fetch: f });
  await settle();
  assert.deepStrictEqual(h.page(), ['p-info'], 'the info form is the first screen');
  assert.strictEqual(h.vis('demo-badge'), true);
  await flowToSaving(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(h.local.map.size, 0, 'the real storage is untouched');
  assert.deepStrictEqual(Array.from(h.session.map.keys()).filter((k) => !k.startsWith('demo:')), []);
});

test('F2r run: the info form needs all four fields and consent with exact messages; the team consent text shows', async () => {
  const h = boot({ search: '?demo=1' });
  await settle();
  assert.strictEqual(h.text('consent-detail'), TEAM_CONSENT.join(String.fromCharCode(10)), 'the demo shows the embedded team text (lines joined by the DOM)');
  const msg = () => h.text('info-error');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '이름과 휴대폰 번호를 입력해 주세요.');
  h.type(h.byId['field-name'], '테스트참가자'); h.type(h.byId['field-phone'], '010-0000-0001');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '이메일을 입력해 주세요.');
  assert.strictEqual(h.byId['field-email'].focused, true);
  h.type(h.byId['field-email'], '   '); // whitespace only
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '이메일을 입력해 주세요.');
  h.type(h.byId['field-email'], 'test@example.com');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '소속을 입력해 주세요.');
  assert.strictEqual(h.byId['field-org'].focused, true);
  h.type(h.byId['field-org'], '  \t '); // whitespace only
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '소속을 입력해 주세요.');
  assert.deepStrictEqual(h.page(), ['p-info']);
  h.type(h.byId['field-org'], '테스트회사 대리');
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '개인정보 수집·이용에 동의해야 참여할 수 있어요.');
  h.type(h.byId['field-name'], 'ㄱ'.repeat(41));
  h.check(h.byId['consent-required'], true);
  h.click(h.byId['info-next']); await settle();
  assert.strictEqual(msg(), '입력한 내용이 너무 길어요. 줄여서 다시 입력해 주세요.');
  h.type(h.byId['field-name'], '테스트참가자');
  h.click(h.byId['info-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-intro'], 'the event intro comes right after the info form');
});

test('F2r run: the concern step has no 17:00 line, its button opens the concern note, the picks survive a reload, and the labels are sent joined by " | "', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await fillInfo(h);
  assert.deepStrictEqual(h.page(), ['p-intro']);
  await startIntro(h);
  assert.deepStrictEqual(h.page(), ['p-concern']);
  assert.strictEqual(h.text('p-concern').indexOf('당신의 브랜드 또는 제품의 고민을 선택해주세요.') !== -1, true, 'the new concern heading');
  assert.strictEqual(h.byId['concern-hint'], undefined, 'the 17:00 line is not on the concern step any more');
  assert.strictEqual(h.text('p-concern').indexOf('오후 5시'), -1);
  assert.strictEqual(h.byId['concern-next'].disabled, true);
  const labels = concernBoxes(h).map((b) => b.value);
  assert.deepStrictEqual(labels, ['신제품을 기획 중이다', '해외 진출을 준비 중이다', '광고 효율 개선이 필요하다', '크리에이터 협업을 검토 중이다', '해당하지 않지만, 발렌을 알고 싶다']);
  h.check(concernBoxes(h)[1], true); h.check(concernBoxes(h)[3], true);
  assert.strictEqual(h.byId['concern-next'].disabled, false);
  // reload at the concern step: the same screen with its picks (stored like any answer)
  const h1 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h1.page(), ['p-concern'], 'a reload returns to the concern step');
  assert.deepStrictEqual(concernBoxes(h1).map((b) => b.checked), [false, true, false, true, false]);
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).answers.concern, '해외 진출을 준비 중이다 | 크리에이터 협업을 검토 중이다');
  h1.click(h1.byId['concern-next']); await settle();
  assert.deepStrictEqual(h1.page(), ['p-concern-note']);
  assert.strictEqual(h1.text('p-concern-note').indexOf('오후 5시, session3, 첫번째 강연에서 해결책을 제시해드립니다') !== -1, true);
  // reload at the concern note
  const h2 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h2.page(), ['p-concern-note']);
  h2.click(h2.byId['concern-note-next']); await settle();
  assert.deepStrictEqual(h2.page(), ['p-quiz']);
  // the quiz: "힌트 :" line, the explanation on the note screen after the answer, CTA "참여 완료", no right/wrong line
  assert.ok(h2.text('q-hint').indexOf('힌트 :') !== -1);
  assert.strictEqual(h2.byId['q-feedback'], undefined, 'no explanation box on the quiz screen');
  h2.type(h2.byId['q-answer'], '틀린 답'); h2.click(h2.byId['q-confirm']); await settle();
  assert.deepStrictEqual(h2.page(), ['p-quiz-note']);
  assert.strictEqual(h2.text('qn-text'), '설명입니다');
  assert.strictEqual(h2.text('q-next'), '참여 완료');
  assert.ok(['정답이에요!', '아쉬워요!', '정답:'].every((s) => h2.byId['p-quiz-note'].textContent.indexOf(s) === -1), 'no right/wrong feedback');
  h2.click(h2.byId['q-next']); await settle();
  const body = f.posts('submit')[0];
  assert.strictEqual(body.entryType, 'info');
  // C28: the quiz answer is never sent; the concern pick is the only answer
  assert.deepStrictEqual(body.answers, [{ questionId: 'concern', value: '해외 진출을 준비 중이다 | 크리에이터 협업을 검토 중이다' }]);
  assert.strictEqual(JSON.stringify(body).indexOf('틀린 답'), -1);
  assert.deepStrictEqual(body.consent, { required: true, marketing: false, version: 'cv1' });
  assert.ok(body.answers[0].value.length <= 100);
});

test('F2r run: the embedded explanation shows offline and the consent collected-items line of the server never reaches the page', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  assert.strictEqual(h.text('consent-detail'), '서버 동의 안내', 'the server consent text wins when it is set');
  const dom = h.byId['p-info'].textContent + h.byId['p-concern'].textContent + h.byId['p-quiz'].textContent + h.byId['p-ticket'].textContent;
  assert.strictEqual(dom.indexOf(LIVE_COLLECTED), -1);
  assert.strictEqual(dom.indexOf('기기 식별값'), -1);
  const f2 = fakeFetch(() => { throw new TypeError('offline'); });
  const h2 = boot({ fetch: f2 });
  await settle();
  assert.strictEqual(h2.text('consent-detail'), TEAM_CONSENT.join(String.fromCharCode(10)), 'offline: the embedded team text');
  assert.strictEqual(h2.byId['info-error'].hidden, true, 'the info path is open offline');
  await fillInfo(h2);
  await h2.advance(5100); // the config fails, then the embedded content is used
  await pickConcern(h2, [0]);
  h2.type(h2.byId['q-answer'], 'x'); h2.click(h2.byId['q-confirm']); await settle();
  assert.strictEqual(h2.text('qn-text'), '80개 브랜드 데이터 기반으로 쌓은 Insight 와' + String.fromCharCode(10) + 'Valen Agent 를 오후 5시에서 보실 수 있습니다.');
  assert.ok(h2.byId['p-info'].textContent.indexOf(LIVE_COLLECTED) === -1);
});

test('F2r run: no consent text blocks the info form up front, and a closed registration is not pre-checked', async () => {
  const f = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData({ infoPathReady: false, registrationOpen: false })); }
    return errEnv('REGISTRATION_CLOSED', false);
  });
  const h = boot({ fetch: f });
  await settle();
  assert.deepStrictEqual(h.page(), ['p-info']);
  assert.strictEqual(h.byId['info-error'].hidden, false);
  assert.strictEqual(h.byId['info-error'].getAttribute('data-error-code'), 'CONSENT_TEXT_MISSING');
  await fillInfo(h);
  assert.strictEqual(h.byId['consent-required'].focused, true);
  assert.deepStrictEqual(h.page(), ['p-info']);
  // a config that is fine but closed: the form works and the server answers at the end
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ registrationOpen: false })) : errEnv('REGISTRATION_CLOSED', false)));
  const h2 = boot({ fetch: f2 });
  await settle();
  await flowToSaving(h2);
  assert.deepStrictEqual(h2.page(), ['p-error']);
  assert.strictEqual(h2.byId['p-error'].getAttribute('data-error-code'), 'REGISTRATION_CLOSED');
});

test('F2r run: offline saving retries with one body; a manual retry after exhaustion stores the ticket', async () => {
  let online = false;
  const f = fakeFetch((url, init) => {
    if (!online) { throw new TypeError('offline'); }
    return init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(7), repeated: false, existing: '', timing: {} });
  });
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h);
  await h.advance(5100); // the config fails (offline), then the embedded content is used
  await pickConcern(h, [0]);
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

test('F2r run: the saving text is written only when it changes', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h); await pickConcern(h, [0]);
  h.type(h.byId['q-answer'], 'a'); h.click(h.byId['q-confirm']); await settle();
  assert.deepStrictEqual(h.page(), ['p-quiz-note']);
  let writes = 0;
  const el = h.byId['saving-text'];
  Object.defineProperty(el, 'textContent', { set(v) { writes += 1; this._text = String(v); }, get() { return this._text; } });
  h.click(h.byId['q-next']); await settle();
  assert.strictEqual(h.text('saving-text'), '잠시만요', 'the short neutral wait copy');
  assert.ok(h.text('p-saving').indexOf('응모권') === -1);
  await h.advance(12000); // twelve one-second ticks: the first text and the 8 s "slow" text only
  assert.ok(writes <= 2, 'the text was written ' + writes + ' times');
  assert.strictEqual(h.text('saving-text'), '사람이 많아 조금 걸리고 있어요. 이 화면을 닫지 말고 기다려 주세요.');
});

// ============================================================================================ run: C28
test('C28 run: the phone field hyphenates while typing, on paste and in the middle of the text; the formatted value is what is sent', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  const phone = h.byId['field-phone'];
  const typed = [['0', '0'], ['010', '010'], ['0101', '010-1'], ['0101234', '010-1234'], ['01012345', '010-1234-5'], ['010-1234-56', '010-1234-56']];
  typed.forEach(([input, shown]) => { h.type(phone, input); assert.strictEqual(phone.value, shown, input); });
  h.type(phone, '01012345678'); assert.strictEqual(phone.value, '010-1234-5678', 'a paste of plain digits');
  h.type(phone, '0101234567'); assert.strictEqual(phone.value, '010-123-4567', 'ten digits: 3-3-4');
  h.type(phone, '010123456789'); assert.strictEqual(phone.value, '010-1234-5678', 'at most eleven digits');
  h.type(phone, '+82 10-1234-5678'); assert.strictEqual(phone.value, '010-1234-5678', 'a pasted international number');
  h.type(phone, '010-12ab'); assert.strictEqual(phone.value, '010-12', 'letters are dropped');
  // an edit in the middle keeps the caret after the same digits instead of jumping to the end
  let caret = null;
  phone.setSelectionRange = (a) => { caret = a; };
  h.type(phone, '010-1234-5');
  phone.selectionStart = 6; // a "9" was typed after "010-1": the browser value is 010-19234-5 with the caret after the 9
  h.type(phone, '010-19234-5');
  assert.strictEqual(phone.value, '010-1923-45');
  assert.strictEqual(caret, 6, 'five digits (0 1 0 1 9) lie before the caret: it stays right after the 9');
  // typing at the end leaves the caret to the browser
  caret = null;
  phone.selectionStart = 10;
  h.type(phone, '0101923456'); // ten raw digits with the caret at the end
  assert.strictEqual(phone.value, '010-192-3456');
  assert.strictEqual(caret, null);
});

test('C28 run: the formatted phone number is sent and shown back after an info error', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h, { phone: '01012345678' });
  assert.deepStrictEqual(h.page(), ['p-intro']);
  await pickConcern(h, [0]); await answerQuiz(h, '차별화');
  assert.strictEqual(f.posts('submit')[0].info.phone, '010-1234-5678');
  // an invalid number is rejected exactly as before the formatting existed
  const h2 = boot({ fetch: f });
  await settle();
  await fillInfo(h2, { phone: '02123456' });
  assert.strictEqual(h2.byId['field-phone'].value, '021-2345-6');
  assert.strictEqual(h2.text('info-error'), '휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)');
  assert.deepStrictEqual(h2.page(), ['p-info']);
});

test('C28 run: the intro shows after the info form, 시작하기 leads to the concern step, and a reload before it returns to the intro', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h.page(), ['p-info']);
  await fillInfo(h);
  assert.deepStrictEqual(h.page(), ['p-intro']);
  assert.strictEqual(h.byId['p-intro'].querySelector('h1'), null, 'no page header on the intro');
  assert.strictEqual(h.text('intro-start'), '시작하기');
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).stage, 'intro', 'the flag is stored');
  // reload before the button: back to the intro, nothing is sent
  const h2 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h2.page(), ['p-intro']);
  assert.strictEqual(f.posts('submit').length, 0);
  await startIntro(h2);
  assert.deepStrictEqual(h2.page(), ['p-concern']);
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).stage, 'concern');
  // reload after the button, at the concern step and later: the intro never comes back
  const h3 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h3.page(), ['p-concern']);
  await pickConcern(h3, [2]);
  assert.deepStrictEqual(h3.page(), ['p-quiz']);
  const h4 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h4.page(), ['p-quiz']);
});

test('C28 run: a stored state from before the intro existed is not forced back to it', async () => {
  const info = { name: '테스트참가자', organization: '테스트회사 대리', phone: '010-0000-0001', email: 'test@example.com' };
  const base = (extra) => storedState(undefined, Object.assign({ ticket: undefined, entryType: 'info', info, consent: { required: true, marketing: false, version: 'a-day-2026-v3' } }, extra));
  const f = fakeFetch(() => { throw new TypeError('offline'); }); // the embedded content, consent version a-day-2026-v3
  // at the concern step (no concern pick yet), with and without a qIndex
  const hA = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: base({ stage: 'quiz', qIndex: 0, answers: {} }) }) });
  await settle(); await hA.advance(5100);
  assert.deepStrictEqual(hA.page(), ['p-concern']);
  // at the quiz
  const hB = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: base({ stage: 'quiz', qIndex: 1, answers: { concern: '신제품을 기획 중이다' } }) }) });
  await settle(); await hB.advance(5100);
  assert.deepStrictEqual(hB.page(), ['p-quiz']);
  // a state with no stage field at all, already past the info form
  const raw = JSON.parse(base({ qIndex: 1, answers: { concern: '신제품을 기획 중이다' } }));
  delete raw.stage;
  const hC = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: JSON.stringify(raw) }) });
  await settle(); await hC.advance(5100);
  assert.deepStrictEqual(hC.page(), ['p-quiz']);
  // stage intro with a stale consent text: the reload returns to the info form with the values kept (once the content is known)
  const stale = storedState(undefined, { ticket: undefined, stage: 'intro', entryType: 'info', info, consent: { required: true, marketing: false, version: 'a-day-2026-v2' } });
  const hD = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: stale }) });
  await settle(); await hD.advance(5100);
  assert.deepStrictEqual(hD.page(), ['p-info']);
  assert.strictEqual(hD.byId['field-name'].value, '테스트참가자');
  assert.strictEqual(hD.byId['consent-required'].checked, false);
});

test('C28 run: a reload at the intro with outdated info (other consent version, or a required field missing) returns to the info form; a current one stays', async () => {
  const full = { name: '테스트참가자', organization: '테스트회사 대리', phone: '010-0000-0001', email: 'test@example.com' };
  const atIntro = (info, version) => storedState(undefined, { ticket: undefined, stage: 'intro', entryType: 'info', info, consent: { required: true, marketing: false, version } });
  const online = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {}))); // server consent version cv1
  // other consent version (the stored one is the embedded v3, the server text is cv1)
  const hA = boot({ fetch: online, local: makeStorage({ [STORE_KEY]: atIntro(full, 'a-day-2026-v3') }) });
  await settle();
  assert.deepStrictEqual(hA.page(), ['p-info']);
  assert.strictEqual(hA.byId['field-org'].value, '테스트회사 대리');
  // a required field missing, same version
  const hB = boot({ fetch: online, local: makeStorage({ [STORE_KEY]: atIntro(Object.assign({}, full, { email: '' }), 'cv1') }) });
  await settle();
  assert.deepStrictEqual(hB.page(), ['p-info']);
  assert.strictEqual(hB.byId['field-name'].value, '테스트참가자');
  assert.strictEqual(hB.byId['consent-required'].checked, true, 'the same consent text keeps its tick');
  // current: the intro stays, and nothing was sent
  const hC = boot({ fetch: online, local: makeStorage({ [STORE_KEY]: atIntro(full, 'cv1') }) });
  await settle();
  assert.deepStrictEqual(hC.page(), ['p-intro']);
  assert.strictEqual(online.posts('submit').length, 0);
  // the outdated-state check also holds while the content is still awaited: the spinner, then the info form
  const slow = deferred();
  const fS = fakeFetch((url, init) => (init.method === 'GET' ? slow.promise : new Promise(() => {})));
  const hS = boot({ fetch: fS, local: makeStorage({ [STORE_KEY]: atIntro(full, 'a-day-2026-v1') }) });
  await settle();
  assert.deepStrictEqual(hS.page(), ['p-wait']);
  slow.resolve(env(cfgData())); await settle();
  assert.deepStrictEqual(hS.page(), ['p-info']);
});

test('C28 run: the intro is not shown again after progress passed it: previous-build states with a stale consent, and a server error that returns to the info form', async () => {
  const info = { name: '테스트참가자', organization: '테스트회사 대리', phone: '010-0000-0001', email: 'test@example.com' };
  // trigger 1: a state of the previous build (stage quiz, no intro flag) with consent v2 goes to the info form, then on
  const offline = fakeFetch(() => { throw new TypeError('offline'); });
  const prev = storedState(undefined, { ticket: undefined, stage: 'quiz', qIndex: 0, answers: {}, entryType: 'info', info, consent: { required: true, marketing: false, version: 'a-day-2026-v2' } });
  const local = makeStorage({ [STORE_KEY]: prev });
  const h = boot({ fetch: offline, local });
  await settle(); await h.advance(5100);
  assert.deepStrictEqual(h.page(), ['p-info']);
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).introDone, true, 'the derived flag is written along with the info stage');
  h.check(h.byId['consent-required'], true);
  h.click(h.byId['info-next']); await settle();
  assert.notDeepStrictEqual(h.page(), ['p-intro'], 'the intro is not shown again');
  await h.advance(5100);
  assert.deepStrictEqual(h.page(), ['p-concern']);
  // the same after a reload at the info form
  const h1 = boot({ fetch: offline, local: makeStorage({ [STORE_KEY]: prev.replace('"stage":"quiz"', '"stage":"info"').replace('"answers":{}', '"answers":{"concern":"신제품을 기획 중이다"}') }) });
  await settle(); await h1.advance(5100);
  assert.deepStrictEqual(h1.page(), ['p-info']);
  h1.check(h1.byId['consent-required'], true);
  h1.click(h1.byId['info-next']); await settle(); await h1.advance(5100);
  assert.deepStrictEqual(h1.page(), ['p-concern'], 'forward from the info form is the concern step once the intro is passed');
  assert.strictEqual(h1.byId['p-concern'].querySelectorAll('input')[0].checked, true, 'the pick is kept');
  // trigger 2: a person who pressed 시작하기 gets a server error that returns to the info form, then submits again
  let posts = 0;
  const f = fakeFetch((url, init) => {
    if (init.method === 'GET') { return env(cfgData()); }
    posts += 1;
    return posts === 1 ? errEnv('INVALID_EMAIL', false) : new Promise(() => {});
  });
  const h2 = boot({ fetch: f });
  await settle();
  await fillInfo(h2);
  assert.deepStrictEqual(h2.page(), ['p-intro'], 'the first pass shows the intro');
  await pickConcern(h2, [0]); await answerQuiz(h2, 'x');
  assert.deepStrictEqual(h2.page(), ['p-info'], 'the server sent the person back to the info form');
  assert.strictEqual(h2.byId['field-name'].value, '테스트참가자');
  h2.check(h2.byId['consent-required'], true);
  h2.click(h2.byId['info-next']); await settle();
  assert.notDeepStrictEqual(h2.page(), ['p-intro'], 'no second intro');
  assert.deepStrictEqual(h2.page(), ['p-concern'], 'forward from the info form is the concern step, picks kept');
  // a fresh attendee on the same device after a finished event reset still sees the intro once
  const h3 = boot({ fetch: fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {}))) });
  await settle();
  await fillInfo(h3);
  assert.deepStrictEqual(h3.page(), ['p-intro']);
});

test('C28 run: Backspace and Delete next to a generated hyphen remove the digit beside it instead of looping', async () => {
  const h = boot({ fetch: fakeFetch(() => { throw new TypeError('offline'); }) });
  await settle();
  const phone = h.byId['field-phone'];
  let caret = null;
  phone.setSelectionRange = (a, b) => { phone.selectionStart = a; phone.selectionEnd = b; caret = a; };
  // fires the browser's beforeinput for a collapsed caret; returns whether the page took over (preventDefault)
  const press = (inputType, at) => {
    phone.selectionStart = at; phone.selectionEnd = at;
    let prevented = false;
    (phone.listeners.beforeinput || []).forEach((fn) => fn({ type: 'beforeinput', inputType, preventDefault() { prevented = true; } }));
    return prevented;
  };
  // Backspace right after a hyphen: the digit before it goes
  h.type(phone, '01012345678'); // 010-1234-5678
  assert.strictEqual(press('deleteContentBackward', 4), true);          // 010-|1234-5678
  assert.strictEqual(phone.value, '011-234-5678');
  assert.strictEqual(caret, 2, 'two digits (0 1) stay in front of the caret');
  h.type(phone, '01012345678');
  assert.strictEqual(press('deleteContentBackward', 9), true);          // 010-1234-|5678
  assert.strictEqual(phone.value, '010-123-5678');
  assert.strictEqual(caret, 7, 'six digits stay in front: right after the 3 of 123');
  // Delete right before a hyphen: the digit after it goes
  h.type(phone, '01012345678');
  assert.strictEqual(press('deleteContentForward', 3), true);           // 010|-1234-5678
  assert.strictEqual(phone.value, '010-234-5678');
  assert.strictEqual(caret, 3);
  h.type(phone, '01012345678');
  assert.strictEqual(press('deleteContentForward', 8), true);           // 010-1234|-5678: the 5 goes, the 4 moves behind the hyphen
  assert.strictEqual(phone.value, '010-123-4678');
  assert.strictEqual(caret, 9, 'seven digits stay in front: right after the 4');
  // everything else is left to the browser (a digit, a selection, the ends of the text, other input types)
  h.type(phone, '01012345678');
  assert.strictEqual(press('deleteContentBackward', 3), false, 'a digit before the caret');
  assert.strictEqual(press('deleteContentForward', 4), false, 'a digit after the caret');
  assert.strictEqual(press('deleteContentBackward', 0), false);
  assert.strictEqual(press('deleteContentForward', phone.value.length), false);
  assert.strictEqual(press('insertText', 4), false);
  phone.selectionStart = 3; phone.selectionEnd = 6;
  let prevented = false;
  phone.listeners.beforeinput.forEach((fn) => fn({ type: 'beforeinput', inputType: 'deleteContentBackward', preventDefault() { prevented = true; } }));
  assert.strictEqual(prevented, false, 'a range selection is deleted by the browser');
  assert.strictEqual(phone.value, '010-1234-5678');
  // repeated Delete walks forward through the digits one at a time
  h.type(phone, '01012345678');
  press('deleteContentForward', 3); // 010-234-5678, caret before the hyphen
  assert.strictEqual(press('deleteContentForward', caret), true);
  assert.strictEqual(phone.value, '010-3456-78');
});


test('C28 run: the embedded quiz question is the final one and the quiz answer is never sent, with embedded and with server content', async () => {
  const f = fakeFetch(() => { throw new TypeError('offline'); });
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h);
  await h.advance(5100);
  await pickConcern(h, [0, 3]);
  assert.strictEqual(h.text('q-title'), "만드는 것이 어려운 시대는 이미 지났습니다." + String.fromCharCode(10) + "'어떻게 OOO를 만들지' 정하는 것이 남은 경쟁입니다.");
  assert.strictEqual(h.text('q-hint-text'), 'ㅊㅂㅎ (3글자)');
  assert.ok(h.text('q-hint').indexOf('힌트 :') !== -1);
  h.type(h.byId['q-answer'], '차별화'); h.click(h.byId['q-confirm']); await settle();
  assert.deepStrictEqual(h.page(), ['p-quiz-note']);
  assert.strictEqual(h.text('qn-text'), '80개 브랜드 데이터 기반으로 쌓은 Insight 와' + String.fromCharCode(10) + 'Valen Agent 를 오후 5시에서 보실 수 있습니다.');
  h.click(h.byId['q-next']); await settle();
  assert.deepStrictEqual(h.page(), ['p-saving'], '참여 완료 on the quiz note saves');
  const body = f.posts('submit')[0];
  assert.deepStrictEqual(body.answers, [{ questionId: 'concern', value: '신제품을 기획 중이다 | 크리에이터 협업을 검토 중이다' }]);
  assert.strictEqual(JSON.stringify(body).indexOf('차별화'), -1);
  // server content: the same rule (the 5 s wait of the offline case is not needed)
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ questions: mkQs(2) })) : new Promise(() => {})));
  const h2 = boot({ fetch: f2 });
  await settle();
  await fillInfo(h2); await pickConcern(h2, [1]);
  assert.strictEqual(h2.text('q-title'), '질문 1');
  await answerQuiz(h2, '서버정답'); // question 1 of 2; the second one follows
  assert.strictEqual(h2.text('q-title'), '질문 2');
  await answerQuiz(h2, '또다른정답');
  const body2 = f2.posts('submit')[0];
  assert.deepStrictEqual(body2.answers, [{ questionId: 'concern', value: '해외 진출을 준비 중이다' }]);
  assert.strictEqual(body2.contentVersion, 'v1');
  assert.strictEqual(JSON.stringify(body2).indexOf('정답'), -1);
});

test('C28 run: the final screen is static after a confirmed save: no ticket box, no clock timer, no extra call', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(7), repeated: false, existing: '', timing: {} })));
  const local = makeStorage();
  const clock = makeClock();
  const h = boot({ fetch: f, local, clock });
  await settle();
  await flowToSaving(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.ok(h.body.classList.contains('done'), 'the gradient page background');
  assert.strictEqual(h.text('p-ticket'), 'Lucky Quiz참여해주셔서 감사합니다담당자에게이 화면을 보여주세요');
  ['ticket-no', 'ticket-clock', 'ticket-status', 'ticket-issued', 'staff-toggle', 'staff-panel', 'staff-pin', 'ticket-recheck'].forEach((id) => assert.strictEqual(h.byId[id], undefined, id));
  assert.strictEqual(clock.timers.size, 0, 'no interval or timeout is left running (no live clock, no saving tick)');
  await clock.advance(30000);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.deepStrictEqual(f.calls.map((c) => c.init.method + ' ' + (c.init.method === 'POST' ? JSON.parse(c.init.body).action : 'config')), ['GET config', 'POST submit']);
  // the server's ticket is still stored (event reconciliation and the confirmation after a reload need it)
  assert.ok(JSON.parse(local.map.get(STORE_KEY)).ticket);
});

test('C28 run: a reload after completion shows the final screen and makes no ticket, status or redeem call', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(4) })));
  const clock = makeClock();
  const h = boot({ fetch: f, clock, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(4)) }) });
  await settle();
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  await clock.advance(20000);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.deepStrictEqual(f.calls.map((c) => c.init.method), ['GET'], 'only the config request');
  assert.strictEqual(clock.timers.size, 0);
  // a used ticket from the old build, or a not-found one, is not looked at either: the screen is the same
  const used = mkTicket(5, { redeemed: true, redeemedAt: '2026-10-14T06:10:00.000Z', redeemedLabel: '15:10' });
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : errEnv('TICKET_NOT_FOUND', false)));
  const h2 = boot({ fetch: f2, local: makeStorage({ [STORE_KEY]: storedState(used) }) });
  await settle();
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
  assert.strictEqual(h2.text('p-ticket').indexOf('룰렛'), -1);
  assert.deepStrictEqual(f2.calls.map((c) => c.init.method), ['GET']);
  // a config for another event still clears an old stored ticket and returns to the first screen
  const f3 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ eventId: 'phonetest-1012' })) : env({ ticket: mkTicket(4) })));
  const h3 = boot({ fetch: f3, local: makeStorage({ [STORE_KEY]: storedState(mkTicket(4)) }) });
  await settle();
  assert.deepStrictEqual(h3.page(), ['p-info']);
});

test('C28 run: the same phone sent again gets the same final screen with no "already issued" note', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(3), repeated: false, existing: 'PHONE', timing: {} })));
  const h = boot({ fetch: f });
  await settle();
  await flowToSaving(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(h.text('p-ticket'), 'Lucky Quiz참여해주셔서 감사합니다담당자에게이 화면을 보여주세요');
  assert.ok(Object.keys(h.byId).every((id) => h.byId[id].textContent.indexOf('이미 발급') === -1));
  // the demo walkthrough ends on the same screen, with the preview badge and no watermark inside it
  const d = boot({ search: '?demo=1' });
  await settle();
  await flowToSaving(d);
  assert.deepStrictEqual(d.page(), ['p-ticket']);
  assert.strictEqual(d.vis('demo-badge'), true);
  assert.strictEqual(d.text('p-ticket').indexOf('미리보기'), -1, 'no watermark inside the final screen');
});

// ============================================================================================ C29: Back, note screens
test('C29 page: Back control on the five middle screens only; intro rows share one left edge; the two note screens carry only their text and button', () => {
  ['p-intro', 'p-concern', 'p-concern-note', 'p-quiz', 'p-quiz-note'].forEach((id) => {
    const sec = section(id);
    assert.ok(/<button type="button" class="back" id="back-[a-z-]+" data-testid="back">이전으로<\/button>/.test(sec), id + ' needs the Back control');
    assert.ok(sec.indexOf('class="back"') < sec.search(/<h[12]/), id + ': Back comes first (top-left)');
  });
  ['p-info', 'p-saving', 'p-error', 'p-ticket', 'p-wait'].forEach((id) => assert.strictEqual(section(id).indexOf('이전으로'), -1, id + ' has no Back'));
  assert.ok(/\.back \{[^}]*text-align: left/.test(html));
  // intro: one block, rows left-aligned inside it (circles in one column, texts at one edge), the block centered
  const intro = section('p-intro');
  assert.ok(/<div class="steps">\s*<p class="step">[\s\S]*<p class="step">[\s\S]*<\/div>/.test(intro), 'both rows sit in one .steps block');
  const steps = html.match(/\.intro \.steps \{[^}]*\}/)[0];
  assert.ok(/width: fit-content/.test(steps) && /margin: 0 auto/.test(steps) && /text-align: left/.test(steps), steps);
  const step = html.match(/\.intro \.step \{[^}]*\}/)[0];
  assert.ok(/display: flex/.test(step) && /justify-content: flex-start/.test(step) && !/justify-content: center/.test(step), step);
  const num = html.match(/\.intro \.num \{[^}]*\}/)[0];
  assert.ok(/flex: none/.test(num) && /width: 30px/.test(num), 'every circle has the same fixed width');
  // the heading, the hint line and the button stay centered
  assert.ok(/\.intro \{ text-align: center;/.test(html));
  // concern note: only the 17:00 line and the button
  const cn = section('p-concern-note');
  assert.strictEqual(squash(cn), '이전으로 오후 5시, session3, 첫번째 강연에서 해결책을 제시해드립니다 다음으로');
  assert.ok(/class="page intro"/.test(markup.match(/<section[^>]*id="p-concern-note"[^>]*>/)[0]), 'same look as the intro');
  assert.strictEqual(section('p-concern').indexOf('오후 5시'), -1);
  assert.strictEqual(markup.indexOf('concern-hint'), -1);
  // quiz note: only the explanation (filled by the page) and the button; the quiz screen has no explanation box
  const qn = section('p-quiz-note');
  assert.strictEqual(squash(qn), '이전으로 참여 완료');
  assert.ok(/class="page intro"/.test(markup.match(/<section[^>]*id="p-quiz-note"[^>]*>/)[0]));
  assert.ok(!/q-feedback|class="explain"/.test(markup), 'no explanation box on the quiz screen');
  assert.ok(/\.intro h2\.note-text \{[^}]*\}/.test(html));
  assert.strictEqual(squash(section('p-quiz')).indexOf('참여 완료'), -1);
});

async function fillFirstPass(h, phone) {
  await fillInfo(h, phone ? { phone } : undefined);   // -> intro
  await startIntro(h);                               // -> concern
}
const values = (h) => ['field-name', 'field-email', 'field-phone', 'field-org'].map((id) => h.byId[id].value);
const click = async (h, id) => { h.click(h.byId[id]); await settle(); };

test('C29 run: Back from every screen lands one screen back and keeps what was entered; an edited phone number is what is sent', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ questions: mkQs(2) })) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h, { phone: '01012345678' });
  assert.deepStrictEqual(h.page(), ['p-intro']);
  // intro -> info: every value and the consent tick are there
  await click(h, 'back-intro');
  assert.deepStrictEqual(h.page(), ['p-info']);
  assert.deepStrictEqual(values(h), ['테스트참가자', 'test@example.com', '010-1234-5678', '테스트회사 대리']);
  assert.strictEqual(h.byId['consent-required'].checked, true);
  // correct the phone number and go forward: the intro again (not passed yet)
  h.type(h.byId['field-phone'], '01099998888');
  await click(h, 'info-next');
  assert.deepStrictEqual(h.page(), ['p-intro']);
  await startIntro(h);
  assert.deepStrictEqual(h.page(), ['p-concern']);
  h.check(concernBoxes(h)[1], true); h.check(concernBoxes(h)[3], true);
  await click(h, 'concern-next');
  assert.deepStrictEqual(h.page(), ['p-concern-note']);
  await click(h, 'concern-note-next');
  assert.deepStrictEqual(h.page(), ['p-quiz']);
  h.type(h.byId['q-answer'], 'abc');                 // typed, not confirmed
  // quiz -> concern note -> concern, picks kept
  await click(h, 'back-quiz');
  assert.deepStrictEqual(h.page(), ['p-concern-note']);
  await click(h, 'back-concern-note');
  assert.deepStrictEqual(h.page(), ['p-concern']);
  assert.deepStrictEqual(concernBoxes(h).map((b) => b.checked), [false, true, false, true, false]);
  assert.strictEqual(h.byId['concern-next'].disabled, false);
  await click(h, 'concern-next'); await click(h, 'concern-note-next');
  assert.deepStrictEqual(h.page(), ['p-quiz']);
  assert.strictEqual(h.byId['q-answer'].value, 'abc', 'the typed answer is still there');
  assert.strictEqual(h.byId['q-confirm'].disabled, false);
  await click(h, 'q-confirm');
  assert.deepStrictEqual(h.page(), ['p-quiz-note']);
  // quiz note -> quiz: the answer is editable again
  await click(h, 'back-quiz-note');
  assert.deepStrictEqual(h.page(), ['p-quiz']);
  assert.strictEqual(h.byId['q-answer'].value, 'abc');
  assert.strictEqual(h.byId['q-answer'].readOnly, false);
  assert.strictEqual(h.byId['q-confirm'].disabled, false);
  h.type(h.byId['q-answer'], 'abd'); await click(h, 'q-confirm');
  assert.deepStrictEqual(h.page(), ['p-quiz-note']);
  await click(h, 'q-next');                          // 다음으로 -> question 2
  assert.strictEqual(h.text('q-title'), '질문 2');
  h.type(h.byId['q-answer'], 'zz');
  // question 2 -> note of question 1 -> question 1 (edited answer kept)
  await click(h, 'back-quiz');
  assert.deepStrictEqual(h.page(), ['p-quiz-note']);
  assert.strictEqual(h.text('q-next'), '다음으로');
  await click(h, 'back-quiz-note');
  assert.strictEqual(h.text('q-title'), '질문 1');
  assert.strictEqual(h.byId['q-answer'].value, 'abd');
  await click(h, 'q-confirm'); await click(h, 'q-next');
  assert.strictEqual(h.text('q-title'), '질문 2');
  assert.strictEqual(h.byId['q-answer'].value, 'zz', 'the draft of question 2 survived the trip');
  await click(h, 'q-confirm');
  assert.strictEqual(h.text('q-next'), '참여 완료');
  await click(h, 'q-next');
  assert.deepStrictEqual(h.page(), ['p-saving']);
  const body = f.posts('submit')[0];
  assert.strictEqual(body.info.phone, '010-9999-8888', 'the corrected phone number is what is sent');
  assert.deepStrictEqual(body.answers, [{ questionId: 'concern', value: '해외 진출을 준비 중이다 | 크리에이터 협업을 검토 중이다' }]);
  assert.strictEqual(JSON.stringify(body).indexOf('abd'), -1);
});

test('C29 run: Back from the concern step always shows the intro; forward from the info form skips a passed intro', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await fillFirstPass(h);
  assert.deepStrictEqual(h.page(), ['p-concern']);
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).introDone, true);
  await click(h, 'back-concern');
  assert.deepStrictEqual(h.page(), ['p-intro'], 'the intro again although it was passed');
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).stage, 'intro');
  // a reload at that intro stays there
  const h2 = boot({ fetch: f, local });
  await settle();
  assert.deepStrictEqual(h2.page(), ['p-intro']);
  // intro -> info -> forward: the concern step (passed intro), not the intro
  await click(h2, 'back-intro');
  assert.deepStrictEqual(h2.page(), ['p-info']);
  assert.strictEqual(h2.byId['consent-required'].checked, true);
  await click(h2, 'info-next');
  assert.deepStrictEqual(h2.page(), ['p-concern']);
  // and the start button of a re-shown intro leads to the concern step again
  await click(h2, 'back-concern'); await startIntro(h2);
  assert.deepStrictEqual(h2.page(), ['p-concern']);
});

test('C29 run: a reload returns to the same screen on the concern note, the quiz (with its draft) and the quiz note', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await fillInfo(h); await pickConcernOnly(h, [2]);
  const a = boot({ fetch: f, local }); await settle();
  assert.deepStrictEqual(a.page(), ['p-concern-note']);
  await click(a, 'concern-note-next');
  a.type(a.byId['q-answer'], '쓰는중');                                 // a draft
  const b = boot({ fetch: f, local }); await settle();
  assert.deepStrictEqual(b.page(), ['p-quiz']);
  assert.strictEqual(b.byId['q-answer'].value, '쓰는중');
  assert.strictEqual(b.byId['q-confirm'].disabled, false);
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).drafts.q1, '쓰는중');
  await click(b, 'q-confirm');
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).drafts.q1, undefined, 'the draft is dropped once confirmed');
  const c = boot({ fetch: f, local }); await settle();
  assert.deepStrictEqual(c.page(), ['p-quiz-note']);
  assert.strictEqual(c.text('qn-text'), '설명입니다');
  // Back and forward from the reloaded note screen still work
  await click(c, 'back-quiz-note');
  assert.strictEqual(c.byId['q-answer'].value, '쓰는중');
  assert.strictEqual(c.byId['q-answer'].readOnly, false);
});

test('C29 run: states written by the previous build (stage quiz) map to the quiz or the quiz note; outdated info still returns to the form', async () => {
  const info = { name: '테스트참가자', organization: '테스트회사 대리', phone: '010-0000-0001', email: 'test@example.com' };
  const prev = (answers, version) => storedState(undefined, { ticket: undefined, stage: 'quiz', qIndex: 1, answers, entryType: 'info', info, consent: { required: true, marketing: false, version } });
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : new Promise(() => {})));
  // a concern pick and a stored quiz answer: the quiz note screen
  const a = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: prev({ concern: '신제품을 기획 중이다', q1: '차별화' }, 'cv1') }) });
  await settle();
  assert.deepStrictEqual(a.page(), ['p-quiz-note']);
  assert.strictEqual(a.text('qn-text'), '설명입니다');
  assert.strictEqual(a.text('q-next'), '참여 완료');
  await click(a, 'back-quiz-note');                  // the stored answer is editable
  assert.strictEqual(a.byId['q-answer'].value, '차별화');
  assert.strictEqual(a.byId['q-answer'].readOnly, false);
  // a concern pick without a quiz answer: the quiz
  const b = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: prev({ concern: '신제품을 기획 중이다' }, 'cv1') }) });
  await settle();
  assert.deepStrictEqual(b.page(), ['p-quiz']);
  assert.strictEqual(b.byId['q-answer'].value, '');
  // nothing answered yet: the concern step
  const c = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: prev({}, 'cv1') }) });
  await settle();
  assert.deepStrictEqual(c.page(), ['p-concern']);
  // outdated consent: the info form first (values kept), then forward goes to the concern step with the pick kept
  const d = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: prev({ concern: '신제품을 기획 중이다', q1: 'x' }, 'a-day-2026-v2') }) });
  await settle();
  assert.deepStrictEqual(d.page(), ['p-info']);
  d.check(d.byId['consent-required'], true);
  await click(d, 'info-next');
  assert.deepStrictEqual(d.page(), ['p-concern']);
  // the same check holds for the new stages: outdated info at the concern note or the quiz note goes back to the form
  for (const stage of ['concern-note', 'question', 'question-note']) {
    const st = storedState(undefined, { ticket: undefined, stage, qIndex: 1, answers: { concern: '신제품을 기획 중이다', q1: 'x' }, entryType: 'info', info, consent: { required: true, marketing: false, version: 'a-day-2026-v2' } });
    const h = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: st }) });
    await settle();
    assert.deepStrictEqual(h.page(), ['p-info'], stage);
    assert.strictEqual(h.byId['field-name'].value, '테스트참가자');
  }
});

// ============================================================================================ run: Codex review (C24)
const DEVICE_KEY = 'valen-quiz:device';
const DEVICE_ID = 'dev-0000-aaaa-bbbb-cccc';
function pendingState(extra) {
  const body = { action: 'submit', apiVersion: 3, requestId: 'req-pending-aaaaaaaa', deviceId: DEVICE_ID, entryType: 'info', info: { name: '테스트참가자', organization: '테스트회사', phone: '010-0000-0001', email: 'test@example.com' },
    consent: { required: true, marketing: false, version: 'a-day-2026-v1' }, contentVersion: 'v1', answers: [{ questionId: 'q1', value: '정답' }], build: DEFAULTS.build };
  return JSON.stringify(Object.assign({ v: 3, savedAt: 1760000000000, eventId: 'a-day-2026', stage: 'saving', entryType: 'info', answers: { concern: '신제품을 기획 중이다', q1: '정답' }, qIndex: 1,
    pending: { requestId: body.requestId, body } }, extra || {}));
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve: (text) => resolve({ text: () => Promise.resolve(text) }) };
}

test('F2r run: a stored pending request waits for config and is not replayed into another event', async () => {
  // another event: no replay, the first screen, the stored state is gone, the device id stays
  const fA = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ eventId: 'phonetest-1012' })) : env({ ticket: mkTicket(1) })));
  const localA = makeStorage({ [STORE_KEY]: pendingState(), [DEVICE_KEY]: DEVICE_ID });
  const hA = boot({ fetch: fA, local: localA });
  await settle();
  assert.strictEqual(fA.posts('submit').length, 0, 'no replay into another event');
  assert.deepStrictEqual(hA.page(), ['p-info']);
  assert.ok(!JSON.parse(localA.map.get(STORE_KEY)).pending, 'no pending request is left');
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
  await fillInfo(h);
  await h.advance(5100); // config still pending: the embedded content
  await pickConcern(h, [0]);
  await answerQuiz(h, 'x');
  assert.deepStrictEqual(h.page(), ['p-saving']);
  cfgD.resolve(env(cfgData({ eventId: 'phonetest-1012' }))); await settle(); // config B while saving
  assert.deepStrictEqual(h.page(), ['p-saving'], 'config does not interrupt the request in flight');
  postD.resolve(env({ ticket: mkTicket(5), repeated: false, existing: '', timing: {} })); await settle(); // ticket of event A
  assert.deepStrictEqual(h.page(), ['p-info'], 'a ticket of another event is not shown');
  assert.ok(!JSON.parse(local.map.get(STORE_KEY) || '{}').ticket, 'and not stored');
  assert.ok(local.writes.length >= 1);
  assert.ok(local.writes.every((w) => w.indexOf('tid-5-') === -1 && w.indexOf('tok-5-') === -1), 'no write ever contained the ticket of the other event');
  assert.strictEqual(local.map.get(DEVICE_KEY), DEVICE_ID);
  // the same event: the ticket is shown
  const cfgE = deferred();
  const postE = deferred();
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? cfgE.promise : postE.promise));
  const local2 = makeStorage();
  const h2 = boot({ fetch: f2, local: local2 });
  await settle();
  await fillInfo(h2);
  await h2.advance(5100);
  await pickConcern(h2, [0]);
  await answerQuiz(h2, 'x');
  cfgE.resolve(env(cfgData())); await settle();
  postE.resolve(env({ ticket: mkTicket(6), repeated: false, existing: '', timing: {} })); await settle();
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
  assert.strictEqual(local2.writes.filter((w) => w.indexOf('tid-6-') !== -1).length, 1, 'the ticket of the matching event is stored once');
});

test('F2r run: a success without a valid ticket is retried and never shown; the pending body is kept', async () => {
  // {"ticket":{}} on every attempt
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : '{"ok":true,"apiVersion":3,"data":{"ticket":{}}}'));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await flowToSaving(h);
  await h.advance(60000);
  const posts = f.posts('submit');
  assert.strictEqual(posts.length, 4, 'four automatic attempts');
  assert.ok(posts.every((p) => JSON.stringify(p) === JSON.stringify(posts[0])));
  assert.deepStrictEqual(h.page(), ['p-saving']);
  assert.strictEqual(h.byId['saving-retry'].hidden, false);
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
  await flowToSaving(h2);
  await h2.advance(5000);
  assert.strictEqual(n, 2, 'retried automatically within the loop, without a tap');
  assert.deepStrictEqual(h2.page(), ['p-ticket']);
});

test('F2r run: the info inputs are empty and the saving state is released once a valid ticket is shown', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : env({ ticket: mkTicket(7), repeated: false, existing: '', timing: {} })));
  const local = makeStorage();
  const h = boot({ fetch: f, local });
  await settle();
  await flowToSaving(h);
  assert.deepStrictEqual(h.page(), ['p-ticket']);
  assert.strictEqual(f.posts('submit')[0].info.name, '테스트참가자', 'the request carried the info');
  assert.strictEqual(f.posts('submit')[0].info.organization, '테스트회사 대리');
  ['field-name', 'field-org', 'field-phone', 'field-email'].forEach((id) => assert.strictEqual(h.byId[id].value, '', id + ' is emptied'));
  assert.strictEqual(JSON.parse(local.map.get(STORE_KEY)).info, undefined);
});

// ============================================================================================ run: Codex review (C27)
const mkQs = (n, firstId) => Array.from({ length: n }, (_, i) => ({ id: firstId && i === 0 ? firstId : 'q' + (i + 1), order: i + 1, type: 'text', title: '질문 ' + (i + 1), hint: '힌트' + (i + 1),
  options: [], imageA: '', imageB: '', captionA: '', captionB: '', accepted: ['정답'], correct: '', explanation: '' }));

test('F2r run: nine server questions and ten server questions: the answers sent are only the concern pick; ten use the embedded fallback', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ questions: mkQs(9) })) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h); await pickConcern(h, [0]);
  for (let i = 1; i <= 9; i++) {
    assert.strictEqual(h.text('q-title'), '질문 ' + i);
    h.type(h.byId['q-answer'], '정답'); h.click(h.byId['q-confirm']); await settle();
    assert.strictEqual(h.text('q-next'), i === 9 ? '참여 완료' : '다음으로');
    h.click(h.byId['q-next']); await settle();
  }
  const body = f.posts('submit')[0];
  assert.deepStrictEqual(body.answers.map((a) => a.questionId), ['concern'], 'nine quiz answers stay on the device');
  // ten server questions: the embedded question is used, with its own content version
  const f2 = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ questions: mkQs(10) })) : new Promise(() => {})));
  const h2 = boot({ fetch: f2 });
  await settle();
  await fillInfo(h2); await pickConcern(h2, [0]);
  assert.ok(h2.text('q-title').indexOf('OOO를 만들지') !== -1, 'the embedded question');
  await answerQuiz(h2, 'x');
  const body2 = f2.posts('submit')[0];
  assert.strictEqual(body2.contentVersion, DEFAULTS.embedded.contentVersion);
  assert.deepStrictEqual(body2.answers.map((a) => a.questionId), ['concern']);
});

test('F2r run: a server question with the reserved id concern falls back to the embedded content without duplicate ids', async () => {
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData({ questions: mkQs(2, 'concern') })) : new Promise(() => {})));
  const h = boot({ fetch: f });
  await settle();
  await fillInfo(h); await pickConcern(h, [1]);
  assert.ok(h.text('q-title').indexOf('OOO를 만들지') !== -1, 'the embedded question, not the Sheet question');
  await answerQuiz(h, 'x');
  const ids = f.posts('submit')[0].answers.map((a) => a.questionId);
  assert.deepStrictEqual(ids, ['concern']);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('F2r run: stored progress for another consent text version or without all four fields resumes at the info form with the values kept', async () => {
  const progress = (info, version) => storedState(undefined, {
    stage: 'quiz', ticket: undefined, qIndex: 1, answers: { concern: '신제품을 기획 중이다' }, info, consent: { required: true, marketing: false, version }
  });
  const full = { name: '테스트참가자', organization: '테스트회사 대리', phone: '010-0000-0001', email: 'test@example.com' };
  const f = fakeFetch(() => { throw new TypeError('offline'); }); // offline: the embedded consent text, version a-day-2026-v3
  // an older consent version (v1, and v2 that was consented before the C28 text change)
  const hV2 = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: progress(full, 'a-day-2026-v2') }) });
  await settle(); await hV2.advance(5100);
  assert.deepStrictEqual(hV2.page(), ['p-info'], 'progress consented under v2 returns to the info form');
  assert.strictEqual(hV2.byId['consent-required'].checked, false);
  const hA = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: progress(full, 'a-day-2026-v1') }) });
  await settle(); await hA.advance(5100);
  assert.deepStrictEqual(hA.page(), ['p-info']);
  assert.strictEqual(hA.byId['field-name'].value, '테스트참가자');
  assert.strictEqual(hA.byId['field-org'].value, '테스트회사 대리');
  assert.strictEqual(hA.byId['field-email'].value, 'test@example.com');
  assert.strictEqual(hA.byId['consent-required'].checked, false, 'the consent must be given again for the new text');
  // a missing field (no organization), same version
  const hB = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: progress(Object.assign({}, full, { organization: '' }), 'a-day-2026-v3') }) });
  await settle(); await hB.advance(5100);
  assert.deepStrictEqual(hB.page(), ['p-info']);
  assert.strictEqual(hB.byId['field-name'].value, '테스트참가자');
  assert.strictEqual(hB.byId['consent-required'].checked, true, 'the same consent text keeps its tick');
  // complete and current: the quiz resumes
  const hC = boot({ fetch: f, local: makeStorage({ [STORE_KEY]: progress(full, 'a-day-2026-v3') }) });
  await settle(); await hC.advance(5100);
  assert.deepStrictEqual(hC.page(), ['p-quiz']);
});

test('F2r run: a throwing async callback shows the boot card and keeps the final screen visible', async () => {
  const post = deferred();
  const f = fakeFetch((url, init) => (init.method === 'GET' ? env(cfgData()) : post.promise));
  const h = boot({ fetch: f });
  await settle();
  await flowToSaving(h);
  assert.deepStrictEqual(h.page(), ['p-saving']);
  assert.strictEqual(h.vis('boot-card'), false);
  // drawing the final screen throws after its page became visible
  h.byId['p-ticket'].querySelector = () => { throw new Error('draw failed'); };
  post.resolve(env({ ticket: mkTicket(6) })); await settle();
  assert.strictEqual(h.vis('boot-card'), true);
  assert.strictEqual(h.vis('p-ticket'), true, 'the final screen stays visible');
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
