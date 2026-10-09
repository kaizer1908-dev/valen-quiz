'use strict';
/*
 * Tests for quiz-core.js and defaults.js (slice F1).
 * Run (Korean): node --test test/quiz-core.test.js
 * Everything is injected: fake fetch, fake clock, in-memory storage. No network, no browser.
 * Fixtures use fake values only (phones 010-0000-xxxx, names 테스트참가자 / 부하테스트-NN, test PIN 0000).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const QC = require('../quiz-core.js');
const DEFAULTS = require('../defaults.js');

const API = 'https://example.invalid/exec';
const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---- fakes ---------------------------------------------------------------------------------------------
// A manual clock: timers only fire when the test advances time.
function makeClock() {
  let t = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    now() { return t; },
    count() { return timers.size; },
    async advance(ms) {
      const target = t + ms;
      await flush();
      for (;;) {
        let best = null;
        for (const [id, tm] of timers) { if (tm.at <= target && (!best || tm.at < best.tm.at)) { best = { id, tm }; } }
        if (!best) { break; }
        timers.delete(best.id);
        t = Math.max(t, best.tm.at);
        best.tm.fn();
        await flush();
      }
      t = target;
      await flush();
    }
  };
}

// Scripted fetch. Steps: {json}, {text}, {reject}, {hang}. The last step repeats.
function makeFetch(steps, onCall) {
  const f = { calls: [], inFlight: 0, maxInFlight: 0 };
  f.fetch = function (url, init) {
    f.calls.push({ url, init, body: init.body });
    if (onCall) { onCall(url, init); }
    const step = steps[Math.min(f.calls.length - 1, steps.length - 1)];
    f.inFlight += 1;
    f.maxInFlight = Math.max(f.maxInFlight, f.inFlight);
    return new Promise((resolve, reject) => {
      const done = () => { f.inFlight -= 1; };
      if (step.hang) {
        if (init.signal) { init.signal.addEventListener('abort', () => { done(); reject(new Error('aborted')); }); }
        return;
      }
      Promise.resolve().then(() => {
        done();
        if (step.reject) { reject(new TypeError('network down')); return; }
        const text = step.json !== undefined ? JSON.stringify(step.json) : step.text;
        resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
      });
    });
  };
  return f;
}

const okEnv = (data) => ({ ok: true, apiVersion: 3, serverMs: 5, data });
const errEnv = (code) => ({ ok: false, apiVersion: 3, serverMs: 5, code, message: 'server text', retryable: false });
const CONFIG_DATA = { eventId: 'a-day-2026', registrationOpen: true, infoPathReady: true, contentReady: false, questions: null };
const TICKET = {
  ticketId: 'aaaaaaaaaaaaaaaa', ticketToken: 'bbbbbbbbbbbbbbbb', ticketNo: 42, ticketLabel: 'No. 042', eventId: 'a-day-2026',
  entryType: 'card', issuedAt: '2026-10-14T06:03:00.000Z', issuedLabel: '15:03', redeemed: false, redeemedAt: '', redeemedLabel: ''
};

function makeApi(f, clock, extra) {
  return QC.createApi(Object.assign({
    url: API, build: '2026-10-10.1', fetch: f.fetch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    random: () => 0.5, now: clock.now
  }, extra || {}));
}

function memStorage(opts) {
  const m = new Map();
  const o = opts || {};
  return {
    m,
    getItem(k) { if (o.throwOnGet) { throw new Error('blocked'); } return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (o.blocked) { throw new Error('blocked'); } m.set(k, String(v)); },
    removeItem(k) { m.delete(k); }
  };
}

const SUBMIT_BODY = {
  action: 'submit', apiVersion: 3, requestId: 'req-aaaaaaaaaaaaaaaa', deviceId: 'dev-aaaaaaaaaaaaaaaa', entryType: 'card',
  info: null, consent: null, contentVersion: 'embedded-2026-10-v1', answers: [{ questionId: 'q1', value: 'x' }], build: '2026-10-10.1'
};

// ---- api -----------------------------------------------------------------------------------------------
test('F1 api: GET config and POST text/plain with credentials omit, redirect follow, no custom headers', async () => {
  const clock = makeClock();
  const f = makeFetch([{ json: okEnv(CONFIG_DATA) }, { json: okEnv({ ticket: TICKET }) }]);
  const api = makeApi(f, clock, { AbortController });

  const cfg = await api.config();
  assert.strictEqual(cfg.ok, true);
  assert.strictEqual(cfg.data.eventId, 'a-day-2026');
  const get = f.calls[0];
  assert.strictEqual(get.url, API + '?action=config&v=2026-10-10.1');
  assert.strictEqual(get.init.method, 'GET');
  assert.strictEqual(get.init.credentials, 'omit');
  assert.strictEqual(get.init.redirect, 'follow');
  assert.strictEqual(get.init.cache, 'no-store');
  assert.strictEqual(get.init.headers, undefined);
  assert.strictEqual(get.init.body, undefined);
  assert.deepStrictEqual(Object.keys(get.init).filter((k) => k !== 'signal').sort(), ['cache', 'credentials', 'method', 'redirect']);

  const t = await api.ticket('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
  assert.strictEqual(t.ok, true);
  const post = f.calls[1];
  assert.strictEqual(post.url, API);
  assert.strictEqual(post.init.method, 'POST');
  assert.strictEqual(post.init.credentials, 'omit');
  assert.strictEqual(post.init.redirect, 'follow');
  assert.strictEqual(post.init.cache, 'no-store');
  assert.deepStrictEqual(post.init.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
  assert.strictEqual(post.init.body, JSON.stringify({ action: 'ticket', apiVersion: 3, ticketId: 'aaaaaaaaaaaaaaaa', ticketToken: 'bbbbbbbbbbbbbbbb' }));
  assert.deepStrictEqual(Object.keys(post.init).filter((k) => k !== 'signal').sort(), ['body', 'cache', 'credentials', 'headers', 'method', 'redirect']);

  await api.submit(SUBMIT_BODY);
  assert.strictEqual(f.calls[2].init.body, JSON.stringify(SUBMIT_BODY));
});

test('F1 api: network, timeout, non-JSON, BUSY and SERVER_ERROR retry with backoff and the identical body', async () => {
  // submit: NETWORK, BAD_RESPONSE (HTML page), BUSY, then success. Backoff 1.5 s, 3 s, 6 s (random 0.5 = no jitter).
  const clock = makeClock();
  const f = makeFetch([{ reject: true }, { text: '<html>Too many simultaneous invocations</html>' }, { json: errEnv('BUSY') }, { json: okEnv({ ticket: TICKET }) }]);
  const states = [];
  const api = makeApi(f, clock, { onState: (s) => states.push(s.state + ':' + s.attempt + '/' + s.max + ':' + s.code) });
  const p = api.submit(SUBMIT_BODY);
  await clock.advance(0);
  assert.strictEqual(f.calls.length, 1);
  await clock.advance(1499); assert.strictEqual(f.calls.length, 1);
  await clock.advance(1); assert.strictEqual(f.calls.length, 2);
  await clock.advance(2999); assert.strictEqual(f.calls.length, 2);
  await clock.advance(1); assert.strictEqual(f.calls.length, 3);
  await clock.advance(5999); assert.strictEqual(f.calls.length, 3);
  await clock.advance(1); assert.strictEqual(f.calls.length, 4);
  const r = await p;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 4);
  assert.strictEqual(new Set(f.calls.map((c) => c.body)).size, 1, 'every attempt sends the identical body');
  assert.strictEqual(f.calls[0].body, JSON.stringify(SUBMIT_BODY));
  assert.strictEqual(f.maxInFlight, 1);
  assert.deepStrictEqual(states, [
    'sending:1/4:', 'waiting:1/4:NETWORK', 'sending:2/4:', 'waiting:2/4:BAD_RESPONSE',
    'sending:3/4:', 'waiting:3/4:BUSY', 'sending:4/4:'
  ]);
  assert.strictEqual(clock.count(), 0, 'no timer is left behind');

  // config: two timeouts (10 s each, aborted through the signal), 1.5 s between, then exhaustion.
  const clock2 = makeClock();
  const f2 = makeFetch([{ hang: true }]);
  const api2 = makeApi(f2, clock2, { AbortController });
  const p2 = api2.config();
  await clock2.advance(9999); assert.strictEqual(f2.calls.length, 1);
  await clock2.advance(1);
  assert.strictEqual(f2.calls[0].init.signal.aborted, true);
  await clock2.advance(1499); assert.strictEqual(f2.calls.length, 1);
  await clock2.advance(1); assert.strictEqual(f2.calls.length, 2);
  await clock2.advance(10000);
  const r2 = await p2;
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.code, 'TIMEOUT');
  assert.strictEqual(r2.retryable, true);
  assert.strictEqual(r2.exhausted, true);
  assert.strictEqual(f2.calls.length, 2);

  // ticket: SERVER_ERROR twice, 2 s apart, then exhausted with the exact Korean copy.
  const clock3 = makeClock();
  const f3 = makeFetch([{ json: errEnv('SERVER_ERROR') }]);
  const api3 = makeApi(f3, clock3);
  const p3 = api3.ticket('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
  await clock3.advance(1999); assert.strictEqual(f3.calls.length, 1);
  await clock3.advance(1); assert.strictEqual(f3.calls.length, 2);
  const r3 = await p3;
  assert.strictEqual(r3.code, 'SERVER_ERROR');
  assert.strictEqual(r3.exhausted, true);
  assert.strictEqual(r3.message, '서버가 잠시 응답하지 않아요. 자동으로 다시 시도할게요.');

  // redeem: three attempts, 1 s then 3 s.
  const clock4 = makeClock();
  const f4 = makeFetch([{ reject: true }, { reject: true }, { json: okEnv({ status: 'REDEEMED', ticket: TICKET }) }]);
  const api4 = makeApi(f4, clock4);
  const p4 = api4.redeem({ ticketId: 'aaaaaaaaaaaaaaaa', ticketToken: 'bbbbbbbbbbbbbbbb', pin: '0000', requestId: 'r-aaaaaaaaaaaaaaaa' });
  await clock4.advance(999); assert.strictEqual(f4.calls.length, 1);
  await clock4.advance(1); assert.strictEqual(f4.calls.length, 2);
  await clock4.advance(2999); assert.strictEqual(f4.calls.length, 2);
  await clock4.advance(1); assert.strictEqual(f4.calls.length, 3);
  assert.strictEqual((await p4).ok, true);
  assert.strictEqual(new Set(f4.calls.map((c) => c.body)).size, 1);

  // jitter is +-30 percent of the base delay.
  for (const [rnd, ms] of [[() => 0, 1050], [() => 1, 1950]]) {
    const c = makeClock();
    const f5 = makeFetch([{ reject: true }, { json: okEnv({ ticket: TICKET }) }]);
    const a = makeApi(f5, c, { random: rnd });
    const p5 = a.submit(SUBMIT_BODY);
    await c.advance(ms - 1); assert.strictEqual(f5.calls.length, 1);
    await c.advance(1); assert.strictEqual(f5.calls.length, 2);
    await p5;
  }

  // saving-screen copy
  assert.strictEqual(QC.savingText(1, 4, 0), '응모권을 발급하고 있어요');
  assert.strictEqual(QC.savingText(1, 4, 8000), '사람이 많아 조금 걸리고 있어요. 이 화면을 닫지 말고 기다려 주세요.');
  assert.strictEqual(QC.savingText(2, 4, 9000), '다시 연결하고 있어요 (2/4)');
  assert.strictEqual(QC.COPY.submitExhausted, "연결이 잠시 불안정해요. 아래 '다시 시도'를 누르거나 부스 스태프에게 이 화면을 보여주세요.");
});

test('F1 api: non-retryable codes stop at once; retryNow resends the same requestId; never two requests in flight', async () => {
  // Exact K1 table (typed separately from the module).
  const TABLE = {
    INVALID_REQUEST: ['요청 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.', false],
    REGISTRATION_CLOSED: ['지금은 참여 접수 시간이 아니에요.', false],
    CONSENT_TEXT_MISSING: ["개인정보 동의 안내가 아직 준비되지 않았어요. 부스 스태프에게 말씀해 주세요.", false],
    REQUIRED_FIELDS: ['이름과 휴대폰 번호를 입력해 주세요.', false],
    INVALID_PHONE: ['휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)', false],
    INVALID_EMAIL: ['이메일 형식을 확인해 주세요.', false],
    CONSENT_REQUIRED: ['개인정보 수집·이용에 동의해야 참여할 수 있어요.', false],
    INVALID_ANSWERS: ['답변 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.', false],
    PARTICIPANT_LIMIT: ['준비된 참여 인원이 모두 찼어요. 부스 스태프에게 문의해 주세요.', false],
    BUSY: ['참여자가 몰려 잠시 대기 중이에요. 자동으로 다시 시도할게요.', true],
    SERVER_ERROR: ['서버가 잠시 응답하지 않아요. 자동으로 다시 시도할게요.', true],
    TICKET_NOT_FOUND: ['응모권을 확인할 수 없어요. 부스 스태프에게 이 화면을 보여주세요.', false],
    STAFF_PIN_NOT_SET: ['스태프 확인 기능이 아직 설정되지 않았어요. (운영자: Config staff_pin)', false],
    PIN_INVALID: ['확인 번호가 맞지 않아요.', false],
    PIN_LOCKED: ['확인 번호 입력이 잠시 잠겼어요. 10분 후 다시 시도하거나 운영자에게 알려 주세요.', false],
    NETWORK: ['연결이 잠시 불안정해요. 자동으로 다시 시도할게요.', true],
    TIMEOUT: ['연결이 잠시 불안정해요. 자동으로 다시 시도할게요.', true],
    BAD_RESPONSE: ['연결이 잠시 불안정해요. 자동으로 다시 시도할게요.', true]
  };
  Object.keys(TABLE).forEach((code) => {
    assert.strictEqual(QC.errorCopy(code), TABLE[code][0], code);
    assert.strictEqual(QC.errorInfo(code).retryable, TABLE[code][1], code + ' retryable');
  });

  // Every non-retryable server code: one request, no timer, the exact copy, last state "failed".
  for (const code of Object.keys(TABLE).filter((c) => !TABLE[c][1] && !['NETWORK', 'TIMEOUT', 'BAD_RESPONSE'].includes(c))) {
    const clock = makeClock();
    const f = makeFetch([{ json: errEnv(code) }]);
    const states = [];
    const api = makeApi(f, clock, { onState: (s) => states.push(s.state) });
    const p = api.submit(SUBMIT_BODY);
    await clock.advance(60000); // a retry (wrong) would fire inside this window
    const r = await p;
    assert.strictEqual(f.calls.length, 1, code + ' is not retried');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, code);
    assert.strictEqual(r.retryable, false);
    assert.strictEqual(r.message, TABLE[code][0]);
    assert.deepStrictEqual(states, ['sending', 'failed']);
  }

  // After exhaustion retryNow re-sends the very same body (same requestId) and can succeed.
  const clock = makeClock();
  const f = makeFetch([{ reject: true }, { reject: true }, { reject: true }, { reject: true }, { json: okEnv({ ticket: TICKET }) }]);
  const api = makeApi(f, clock);
  const p = api.submit(SUBMIT_BODY);
  await clock.advance(1500 + 3000 + 6000);
  const ex = await p;
  assert.strictEqual(ex.exhausted, true);
  assert.strictEqual(f.calls.length, 4);
  const again = await api.retryNow('submit');
  assert.strictEqual(again.ok, true);
  assert.strictEqual(f.calls.length, 5);
  assert.strictEqual(f.calls[4].body, f.calls[0].body);
  assert.strictEqual(JSON.parse(f.calls[4].body).requestId, SUBMIT_BODY.requestId);
  assert.strictEqual((await api.retryNow('submit')).code, 'NOTHING_TO_RETRY');

  // retryNow during a backoff cancels the wait and sends at once.
  const clockB = makeClock();
  const fB = makeFetch([{ reject: true }, { json: okEnv({ ticket: TICKET }) }]);
  const apiB = makeApi(fB, clockB);
  const pB = apiB.submit(SUBMIT_BODY);
  await clockB.advance(0);
  assert.strictEqual(fB.calls.length, 1);
  const rn = apiB.retryNow('submit');
  assert.strictEqual(rn, pB);
  await flush();
  assert.strictEqual(fB.calls.length, 2, 'sent without waiting 1.5 s');
  assert.strictEqual((await pB).ok, true);
  assert.strictEqual(clockB.count(), 0);

  // Single flight: same request joins the active promise, a different one is refused, retryNow adds nothing.
  const clockC = makeClock();
  const fC = makeFetch([{ hang: true }]);
  const apiC = makeApi(fC, clockC);
  const p1 = apiC.submit(SUBMIT_BODY);
  const p2 = apiC.submit(SUBMIT_BODY);
  assert.strictEqual(p2, p1);
  const other = await apiC.submit(Object.assign({}, SUBMIT_BODY, { requestId: 'req-bbbbbbbbbbbbbbbb' }));
  assert.strictEqual(other.ok, false);
  assert.strictEqual(other.code, 'IN_FLIGHT');
  assert.strictEqual(apiC.retryNow('submit'), p1);
  await flush();
  assert.strictEqual(fC.calls.length, 1);
  assert.strictEqual(fC.maxInFlight, 1);
});

// ---- phone and info ------------------------------------------------------------------------------------
test('F1 phone: normalization matches the shared vectors', () => {
  const accept = [
    ['010-1234-5678', '01012345678'], ['01012345678', '01012345678'], ['010 1234 5678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'], ['+82 010-1234-5678', '01012345678'], ['０１０１２３４５６７８', '01012345678'],
    ['0110000000', '0110000000'], ['01100000000', '01100000000']
  ];
  accept.forEach(([input, expected]) => assert.strictEqual(QC.normalizePhone(input), expected, input));
  ['02-123-4567', '0101234567', '010-1234-567a', '01200000000', '010000000001', ''].forEach((input) => {
    assert.strictEqual(QC.normalizePhone(input), '', JSON.stringify(input));
  });
  assert.strictEqual(QC.normalizePhone(null), '');
  assert.strictEqual(QC.normalizePhone(undefined), '');
});

test('F1 info: card skips everything; info needs name, valid phone, required consent; email optional but checked; info blocked when infoPathReady false', () => {
  const good = { name: '테스트참가자', organization: '', phone: '010-0000-0001', email: '' };
  const yes = { required: true, marketing: false };
  assert.deepStrictEqual(QC.validateInfo('card', null, null, false), { ok: true, code: '', field: '' });
  assert.deepStrictEqual(QC.validateInfo('card', { name: '' }, { required: false }, true), { ok: true, code: '', field: '' });
  assert.deepStrictEqual(QC.validateInfo('info', good, yes, true), { ok: true, code: '', field: '' });
  assert.deepStrictEqual(QC.validateInfo('info', good, yes, false), { ok: false, code: 'CONSENT_TEXT_MISSING', field: 'consent' });
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { name: '   ' }), yes, true), { ok: false, code: 'REQUIRED_FIELDS', field: 'name' });
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { phone: '' }), yes, true), { ok: false, code: 'REQUIRED_FIELDS', field: 'phone' });
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { phone: '02-123-4567' }), yes, true), { ok: false, code: 'INVALID_PHONE', field: 'phone' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { phone: '０１０－１２３４－５６７８' }), yes, true).ok, true);
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { email: 'not-an-email' }), yes, true), { ok: false, code: 'INVALID_EMAIL', field: 'email' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { email: 'test@example.com' }), yes, true).ok, true);
  assert.deepStrictEqual(QC.validateInfo('info', good, { required: false, marketing: true }, true), { ok: false, code: 'CONSENT_REQUIRED', field: 'consent' });
  assert.deepStrictEqual(QC.validateInfo('info', good, null, true), { ok: false, code: 'CONSENT_REQUIRED', field: 'consent' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { name: 'x'.repeat(41) }), yes, true).code, 'LENGTH');
  assert.strictEqual(QC.validateInfo('bogus', good, yes, true).code, 'INVALID_REQUEST');
});

// ---- payload -------------------------------------------------------------------------------------------
test('F1 payload: card body carries no personal fields; info body carries the consent version shown', () => {
  const content = QC.effectiveContent(null, DEFAULTS.embedded);
  const personal = { name: '테스트참가자', organization: '테스트소속', phone: '010-0000-0001', email: 'test@example.com' };

  // A person typed info, then ticked the card box: nothing personal may travel.
  const cardState = { entryType: 'card', info: personal, consent: { required: true, marketing: true }, answers: { q1: '정답' } };
  const card = QC.buildSubmitBody(cardState, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', '2026-10-10.1');
  assert.strictEqual(card.action, 'submit');
  assert.strictEqual(card.apiVersion, 3);
  assert.strictEqual(card.entryType, 'card');
  assert.strictEqual(card.info, null);
  assert.strictEqual(card.consent, null);
  assert.strictEqual(card.requestId, 'req-aaaaaaaaaaaaaaaa');
  assert.strictEqual(card.deviceId, 'dev-aaaaaaaaaaaaaaaa');
  assert.strictEqual(card.contentVersion, 'embedded-2026-10-v1');
  assert.strictEqual(card.build, '2026-10-10.1');
  assert.deepStrictEqual(card.answers, [{ questionId: 'q1', value: '정답' }]);
  const raw = JSON.stringify(card);
  ['테스트참가자', '테스트소속', '010-0000-0001', 'test@example.com'].forEach((s) => assert.strictEqual(raw.indexOf(s), -1, s));

  // Info entry: consent version is the one of the text that was shown (here from a server config).
  const server = QC.effectiveContent({
    eventId: 'a-day-2026', registrationOpen: true, infoPathReady: true, contentVersion: '2026-10-v1', contentReady: true,
    questions: [{ id: 'q1', order: 1, type: 'text', title: 't', hint: 'h', accepted: ['a'] }, { id: 'q2', order: 2, type: 'text', title: 't', hint: 'h', accepted: ['b'] }],
    consent: { version: 'server-consent-v9', collectedItems: 'x', requiredDetail: '동의 안내', marketingDetail: '' }
  }, DEFAULTS.embedded);
  const infoState = {
    entryType: 'info', info: { name: ' 부하테스트-01 ', organization: '', phone: '010-0000-0002', email: '' },
    consent: { required: true, marketing: false }, answers: { q1: 'a'.repeat(150), q2: '', zzz: 'ignored' }
  };
  const info = QC.buildSubmitBody(infoState, server, 'dev-aaaaaaaaaaaaaaaa', 'req-bbbbbbbbbbbbbbbb', '2026-10-10.1');
  assert.strictEqual(info.entryType, 'info');
  assert.deepStrictEqual(info.info, { name: '부하테스트-01', organization: '', phone: '010-0000-0002', email: '' });
  assert.deepStrictEqual(info.consent, { required: true, marketing: false, version: 'server-consent-v9' });
  assert.strictEqual(info.contentVersion, '2026-10-v1');
  assert.strictEqual(info.answers.length, 1, 'blank and unknown answers are not sent');
  assert.strictEqual(info.answers[0].value.length, 100);
  assert.ok(JSON.stringify(info).length < 10 * 1024);
});

// ---- storage -------------------------------------------------------------------------------------------
test('F1 storage: device id persists; TTL 36 h; event mismatch clears ticket and progress but keeps device id; blocked storage fails soft', () => {
  // device id
  const s = memStorage();
  const id1 = QC.getDeviceId(s);
  assert.ok(QC.ID_PATTERN.test(id1));
  assert.strictEqual(QC.getDeviceId(s), id1);
  s.setItem(QC.STORAGE_KEYS.device, 'bad id!');
  const id2 = QC.getDeviceId(s);
  assert.ok(QC.ID_PATTERN.test(id2));
  assert.notStrictEqual(id2, 'bad id!');
  // id fallbacks: randomUUID, then getRandomValues, then Math.random
  assert.strictEqual(QC.newId({ crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' } }), '11111111-2222-4333-8444-555555555555');
  const viaValues = QC.newId({ crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { a[i] = i * 7; } return a; } } });
  assert.ok(QC.ID_PATTERN.test(viaValues));
  let n = 0;
  const viaMath = QC.newId({ crypto: null, random: () => ((n++ * 37) % 256) / 256 });
  assert.ok(QC.ID_PATTERN.test(viaMath));
  assert.notStrictEqual(QC.newId({ crypto: null }), QC.newId({ crypto: null }));

  // TTL 36 h
  const T0 = 1712345678901;
  const H36 = 36 * 60 * 60 * 1000;
  const st = { eventId: 'a-day-2026', stage: 'quiz', entryType: 'card', answers: { q1: 'a' }, qIndex: 0 };
  assert.strictEqual(QC.saveState(s, st, T0), true);
  assert.strictEqual(QC.loadState(s, T0 + H36).answers.q1, 'a');
  assert.strictEqual(QC.loadState(s, T0 + H36 + 1), null);
  assert.strictEqual(s.getItem(QC.STORAGE_KEYS.state), null, 'expired state is removed');
  s.setItem(QC.STORAGE_KEYS.state, '{not json');
  assert.strictEqual(QC.loadState(s, T0), null);
  s.setItem(QC.STORAGE_KEYS.state, JSON.stringify({ v: 2, savedAt: T0 }));
  assert.strictEqual(QC.loadState(s, T0), null);

  // event mismatch: progress and ticket go, the device id stays
  const phonetest = Object.assign({}, st, { eventId: 'phonetest-1012', stage: 'ticket', ticket: Object.assign({}, TICKET, { eventId: 'phonetest-1012' }) });
  QC.saveState(s, phonetest, T0);
  const kept = s.getItem(QC.STORAGE_KEYS.device);
  const same = QC.resetForEvent(s, QC.loadState(s, T0), 'phonetest-1012');
  assert.strictEqual(same.reset, false);
  assert.ok(same.state.ticket);
  const res = QC.resetForEvent(s, QC.loadState(s, T0), 'a-day-2026');
  assert.strictEqual(res.reset, true);
  assert.strictEqual(res.state.ticket, undefined);
  assert.deepStrictEqual(res.state.answers, {});
  assert.strictEqual(res.state.eventId, 'a-day-2026');
  assert.strictEqual(s.getItem(QC.STORAGE_KEYS.state), null);
  assert.strictEqual(s.getItem(QC.STORAGE_KEYS.device), kept);
  assert.strictEqual(QC.getDeviceId(s), kept);
  // a ticket issued under another event is dropped even when the stored state claims the new event
  const mixed = Object.assign({}, st, { eventId: 'a-day-2026', stage: 'ticket', ticket: Object.assign({}, TICKET, { eventId: 'phonetest-1012' }) });
  QC.saveState(s, mixed, T0);
  assert.strictEqual(QC.resetForEvent(s, QC.loadState(s, T0), 'a-day-2026').reset, true);

  // blocked storage fails soft
  const blocked = memStorage({ blocked: true, throwOnGet: true });
  assert.strictEqual(QC.saveState(blocked, st, T0), false);
  assert.strictEqual(QC.loadState(blocked, T0), null);
  assert.ok(QC.ID_PATTERN.test(QC.getDeviceId(blocked)));
  assert.doesNotThrow(() => QC.resetForEvent(blocked, phonetest, 'a-day-2026'));
  assert.strictEqual(QC.saveState(null, st, T0), false);
  assert.strictEqual(QC.loadState(null, T0), null);
  assert.ok(QC.ID_PATTERN.test(QC.getDeviceId(undefined)));
});

test('F1 storage: pending body saved before the first send; info and pending dropped once the ticket is stored; PIN never stored', async () => {
  const T = 1712345678901;
  const s = memStorage();
  const content = QC.effectiveContent(null, DEFAULTS.embedded);
  const state = {
    eventId: 'a-day-2026', stage: 'saving', entryType: 'info', info: { name: '테스트참가자', organization: '', phone: '010-0000-0003', email: '' },
    consent: { required: true, marketing: false, version: 'a-day-2026-v1' }, answers: { q1: '답' }, qIndex: 0
  };
  const body = QC.buildSubmitBody(state, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', '2026-10-10.1');

  let snapshotAtSend = null;
  const fake = {
    submit(b) {
      snapshotAtSend = s.getItem(QC.STORAGE_KEYS.state);
      return Promise.resolve({ ok: true, data: { ticket: TICKET, repeated: false, existing: '' }, attempts: 1 });
    }
  };
  const out = await QC.submitWithPending(fake, s, state, body, T);
  const before = JSON.parse(snapshotAtSend);
  assert.strictEqual(before.pending.requestId, 'req-aaaaaaaaaaaaaaaa');
  assert.deepStrictEqual(before.pending.body, body, 'the exact body is stored before the send');
  assert.strictEqual(out.response.ok, true);

  const after = s.getItem(QC.STORAGE_KEYS.state);
  const stored = JSON.parse(after);
  assert.strictEqual(stored.ticket.ticketNo, 42);
  assert.strictEqual(stored.info, undefined);
  assert.strictEqual(stored.pending, undefined);
  ['테스트참가자', '010-0000-0003', 'pending'].forEach((x) => assert.strictEqual(after.indexOf(x), -1, x));
  assert.strictEqual(out.state.info, undefined);

  // saveState itself refuses to keep info/pending next to a ticket
  const raw = (QC.saveState(s, Object.assign({}, state, { ticket: TICKET, pending: { requestId: 'r', body } }), T), s.getItem(QC.STORAGE_KEYS.state));
  assert.strictEqual(JSON.parse(raw).info, undefined);
  assert.strictEqual(JSON.parse(raw).pending, undefined);

  // A non-retryable failure forgets the request (the server wrote nothing); a retryable one keeps it.
  const bad = { submit: () => Promise.resolve({ ok: false, code: 'INVALID_PHONE', retryable: false, action: 'back-to-info' }) };
  const r1 = await QC.submitWithPending(bad, s, state, body, T);
  assert.strictEqual(r1.state.pending, undefined);
  assert.strictEqual(r1.state.stage, 'info');
  assert.strictEqual(JSON.parse(s.getItem(QC.STORAGE_KEYS.state)).pending, undefined);
  const flaky = { submit: () => Promise.resolve({ ok: false, code: 'TIMEOUT', retryable: true, exhausted: true }) };
  const r2 = await QC.submitWithPending(flaky, s, state, body, T);
  assert.strictEqual(JSON.parse(s.getItem(QC.STORAGE_KEYS.state)).pending.requestId, 'req-aaaaaaaaaaaaaaaa');
  assert.strictEqual(r2.state.stage, 'saving');

  // The staff PIN (test value 0000) and any stray field never reach storage.
  QC.saveState(s, Object.assign({}, state, { info: undefined, pin: '0000', staffPin: '0000', pinDraft: '0000' }), T);
  const pinRaw = s.getItem(QC.STORAGE_KEYS.state);
  assert.strictEqual(pinRaw.indexOf('0000'), -1);
  assert.ok(!/pin/i.test(pinRaw));
  const keys = Object.keys(JSON.parse(pinRaw));
  keys.forEach((k) => assert.ok(['v', 'savedAt', 'eventId', 'stage', 'entryType', 'info', 'consent', 'answers', 'qIndex', 'pending', 'ticket'].includes(k), k));
});

// ---- config, grading, routing, view model --------------------------------------------------------------
test('F1 config: server content only when contentReady with questions, else embedded', () => {
  const emb = DEFAULTS.embedded;
  const q = [{ id: 'q1', order: 1, type: 'text', title: '서버 문항', hint: 'h', accepted: ['a'] }];
  const base = {
    eventId: 'a-day-2026', registrationOpen: true, infoPathReady: true, contentVersion: '2026-10-v1',
    consent: { version: 'srv-v1', collectedItems: 'c', requiredDetail: '서버 동의 안내', marketingDetail: '' }
  };
  const ready = QC.effectiveContent(Object.assign({}, base, { contentReady: true, questions: q }), emb);
  assert.strictEqual(ready.source, 'server');
  assert.strictEqual(ready.questions[0].title, '서버 문항');
  assert.strictEqual(ready.contentVersion, '2026-10-v1');
  assert.strictEqual(ready.consent.version, 'srv-v1');
  assert.strictEqual(ready.infoPathReady, true);

  // contentReady false: questions are null on the real server; even a non-empty list must be ignored.
  [{ contentReady: false, questions: null }, { contentReady: false, questions: q }, { contentReady: true, questions: [] },
    { contentReady: true, questions: null }, { contentReady: 'true', questions: q }].forEach((patch) => {
    const c = QC.effectiveContent(Object.assign({}, base, patch), emb);
    assert.strictEqual(c.source, 'embedded', JSON.stringify(patch));
    assert.strictEqual(c.questions, emb.questions);
    assert.strictEqual(c.contentVersion, emb.contentVersion);
  });
  const none = QC.effectiveContent(null, emb);
  assert.strictEqual(none.source, 'embedded');
  assert.strictEqual(none.registrationOpen, true);
  assert.strictEqual(none.eventId, 'a-day-2026');
  assert.strictEqual(none.infoPathReady, true, 'the embedded consent is the team text now, so the info path is open offline');

  // gates come from the server even when the questions fall back
  const closed = QC.effectiveContent(Object.assign({}, base, { contentReady: false, questions: null, registrationOpen: false, infoPathReady: false }), emb);
  assert.strictEqual(closed.registrationOpen, false);
  assert.strictEqual(closed.infoPathReady, false);
  assert.strictEqual(QC.effectiveContent(Object.assign({}, base, { contentReady: true, questions: q, infoPathReady: false }), emb).infoPathReady, false);

  // defaults.js shape
  assert.strictEqual(emb.eventId, 'a-day-2026');
  assert.strictEqual(emb.contentVersion, 'embedded-2026-10-v1');
  assert.strictEqual(emb.consent.version, 'a-day-2026-v1');
  assert.strictEqual(emb.consent.collectedItems, '수집 항목: 이름, 휴대폰 번호, 소속(입력한 경우), 이메일(입력한 경우), 퀴즈 응답, 기기 식별값(중복 참여 방지용)');
  // The team's consent text (C25), verbatim, four lines.
  assert.strictEqual(emb.consent.requiredDetail, [
    '- 수집 항목 : 이름, 연락처, 이메일, 회사명·직책, 고민 유형·퀴즈 응답, 기기 식별값(중복 참여 방지용)',
    '- 이용 목적 이벤트 운영(참여 확인·경품 추첨)',
    '- 보유 기간 수집일로부터 1년 (목적 달성 시 지체 없이 파기)',
    '- 귀하는 개인정보 수집 및 이용에 대한 동의를 거부할 권리가 있습니다. 단, 필수 항목 동의 거부 시 이벤트 참여 및 경품 수령이 제한됩니다.'
  ].join(String.fromCharCode(10)));
  assert.strictEqual(emb.consent.version, 'a-day-2026-v1', 'the consent version is unchanged');
  assert.strictEqual(emb.questions[0].explanation, '80개 브랜드 데이터 기반으로 쌓은 Insight 와 Valen Agent 를 오후 5시에서 보실 수 있습니다.');
  assert.strictEqual(emb.questions.length, 1);
  assert.strictEqual(emb.questions[0].type, 'text');
  assert.deepStrictEqual(emb.questions[0].accepted, ['[입력 필요]']);
  assert.ok(QC.ID_PATTERN.test(DEFAULTS.build.replace(/\./g, '-').padEnd(16, '0')));
  assert.ok(DEFAULTS.apiUrl.indexOf('https://script.google.com/macros/s/') === 0 && /\/exec$/.test(DEFAULTS.apiUrl));
});

test('F1 grade: display grading matches the K3 normalization examples', () => {
  const text = { type: 'text', accepted: ['히어로 SKU', 'a·b', "it's"] };
  assert.strictEqual(QC.normalizeAnswerText('Ａ b.,!?·\'"-'), 'ab');
  assert.strictEqual(QC.gradeForDisplay(text, '히어로sku'), true);
  assert.strictEqual(QC.gradeForDisplay(text, '  히어로-SKU! '), true);
  assert.strictEqual(QC.gradeForDisplay(text, '히어로　ＳＫＵ'), true, 'NFKC folds full-width letters and the ideographic space');
  assert.strictEqual(QC.gradeForDisplay(text, 'AB'), true);
  assert.strictEqual(QC.gradeForDisplay(text, 'ITS'), true);
  assert.strictEqual(QC.gradeForDisplay(text, '히어로 에스케이유'), false);
  assert.strictEqual(QC.gradeForDisplay(text, ''), false);
  assert.strictEqual(QC.gradeForDisplay(text, ' . - '), false, 'only removable characters never matches');
  assert.strictEqual(QC.gradeForDisplay({ type: 'text', accepted: [] }, 'x'), false);
  assert.strictEqual(QC.gradeForDisplay({ type: 'choice', correct: 'B' }, 'B'), true);
  assert.strictEqual(QC.gradeForDisplay({ type: 'choice', correct: 'B' }, 'A'), false);
  assert.strictEqual(QC.gradeForDisplay({ type: 'choice', correct: '' }, 'A'), '', 'no right answer gives a blank grade');
  assert.strictEqual(QC.gradeForDisplay({ type: 'ab', correct: 'A' }, 'A'), true);
  assert.strictEqual(QC.gradeForDisplay({ type: 'ab', correct: 'A' }, 'B'), false);
  assert.strictEqual(QC.gradeForDisplay({ type: 'ab', correct: 'A' }, 'a'), false);
  assert.strictEqual(QC.gradeForDisplay({ type: 'unknown' }, 'a'), '');
});

test('F1 route: reload routes to ticket, saving (resend pending), quiz, info or landing', () => {
  const body = { requestId: 'req-aaaaaaaaaaaaaaaa' };
  const content = { questions: [{ id: 'q1' }, { id: 'q2' }] };
  assert.deepStrictEqual(QC.routeOnLoad(null), { route: 'landing' });
  assert.deepStrictEqual(QC.routeOnLoad(QC.freshState('a-day-2026')), { route: 'landing' });
  assert.deepStrictEqual(QC.routeOnLoad({ stage: 'info', answers: {} }), { route: 'info' });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'info', stage: 'info', answers: {} }), { route: 'info' });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'quiz', answers: {}, qIndex: 0 }, content), { route: 'quiz', qIndex: 0 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'quiz', answers: { q1: 'a' }, qIndex: 0 }, content), { route: 'quiz', qIndex: 1 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'quiz', answers: {}, qIndex: 3 }), { route: 'quiz', qIndex: 3 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'info', info: { name: 'n' }, answers: { q1: 'a' } }, content), { route: 'quiz', qIndex: 1 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', answers: { q1: 'a', q2: 'b' } }, content), { route: 'quiz', qIndex: 1 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', answers: { q1: 'a' }, pending: { requestId: body.requestId, body } }, content), { route: 'saving', resend: true });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', answers: {}, ticket: TICKET, pending: { requestId: body.requestId, body } }), { route: 'ticket' });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', answers: {}, pending: { requestId: '', body: null } }, content), { route: 'quiz', qIndex: 0 });
});

test('F1 ticket: view model labels No. 042, issue and used times, status unused/used/unknown', () => {
  const now = new Date(2026, 9, 14, 15, 3, 7);
  const unused = QC.ticketViewModel(TICKET, now);
  assert.strictEqual(unused.label, 'No. 042');
  assert.strictEqual(unused.issuedText, '발급 15:03');
  assert.strictEqual(unused.status, 'unused');
  assert.strictEqual(unused.statusText, '룰렛 참여 전');
  assert.strictEqual(unused.clockText, '지금 15:03:07');
  assert.strictEqual(unused.redeemed, false);
  assert.strictEqual(unused.demo, false);

  const used = QC.ticketViewModel(Object.assign({}, TICKET, { redeemed: true, redeemedAt: '2026-10-14T06:10:00.000Z', redeemedLabel: '15:10' }), now);
  assert.strictEqual(used.status, 'used');
  assert.strictEqual(used.statusText, '룰렛 참여 완료 (15:10)');
  assert.strictEqual(used.redeemed, true);

  // labels derived from the number and ISO time when the server labels are absent
  const bare = QC.ticketViewModel({ ticketNo: 7, issuedAt: new Date(2026, 9, 14, 9, 5, 0).toISOString(), redeemed: false }, now);
  assert.strictEqual(bare.label, 'No. 007');
  assert.strictEqual(bare.issuedLabel, '09:05');
  assert.strictEqual(QC.ticketViewModel({ ticketNo: 1234 }, now).label, 'No. 1234');

  assert.strictEqual(QC.ticketViewModel(TICKET, now, { check: 'not_found' }).status, 'unknown');
  assert.strictEqual(QC.ticketViewModel(TICKET, now, { check: 'not_found' }).statusText, '확인 불가');
  assert.strictEqual(QC.ticketViewModel(TICKET, now, { check: 'checking' }).statusText, '확인 중');
  const offline = QC.ticketViewModel(Object.assign({}, TICKET, { redeemed: true, redeemedLabel: '15:10' }), now, { check: 'unreachable' });
  assert.strictEqual(offline.status, 'used', 'the stored status stays');
  assert.strictEqual(offline.showRecheck, true);
  assert.strictEqual(offline.recheckText, '상태 다시 확인');
  assert.strictEqual(QC.ticketViewModel(TICKET, now, { existing: 'PHONE' }).note, '이 번호로 이미 발급된 응모권을 불러왔어요.');
  assert.strictEqual(QC.ticketViewModel(TICKET, now).note, '');
  const demo = QC.ticketViewModel(Object.assign({}, TICKET, { demo: true }), now);
  assert.strictEqual(demo.demo, true);
  assert.strictEqual(demo.demoWatermark, '미리보기 (사용 불가)');
});

test('F1 demo: demo api issues a demo-flagged ticket and never calls fetch', async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = function () { fetchCalls += 1; throw new Error('demo must not use fetch'); };
  try {
    let t = Date.parse('2026-10-14T06:03:00.000Z');
    const demo = QC.createDemoApi({ now: () => t });
    const cfg = await demo.config();
    assert.strictEqual(cfg.ok, true);
    assert.strictEqual(cfg.data.contentReady, false);
    assert.strictEqual(cfg.data.questions, null);

    const first = await demo.submit(SUBMIT_BODY);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.data.ticket.demo, true);
    assert.strictEqual(first.data.ticket.ticketLabel, 'No. 001');
    assert.ok(QC.ID_PATTERN.test(first.data.ticket.ticketId));
    const repeat = await demo.submit(SUBMIT_BODY);
    assert.strictEqual(repeat.data.repeated, true);
    assert.strictEqual(repeat.data.ticket.ticketId, first.data.ticket.ticketId);
    const second = await demo.submit(Object.assign({}, SUBMIT_BODY, { requestId: 'req-cccccccccccccccc', deviceId: 'dev-cccccccccccccccc' }));
    assert.strictEqual(second.data.ticket.ticketLabel, 'No. 002');

    const { ticketId, ticketToken } = first.data.ticket;
    assert.strictEqual((await demo.ticket(ticketId, ticketToken)).data.ticket.redeemed, false);
    assert.strictEqual((await demo.ticket(ticketId, 'wrong-token-0000000')).code, 'TICKET_NOT_FOUND');
    t += 7 * 60 * 1000;
    const red = await demo.redeem({ ticketId, ticketToken, pin: '0000', requestId: 'red-aaaaaaaaaaaaaaaa' });
    assert.strictEqual(red.data.status, 'REDEEMED');
    assert.strictEqual(red.data.ticket.redeemedLabel.length, 5);
    assert.strictEqual((await demo.redeem({ ticketId, ticketToken, pin: '0000', requestId: 'red-aaaaaaaaaaaaaaaa' })).data.status, 'REDEEMED');
    assert.strictEqual((await demo.redeem({ ticketId, ticketToken, pin: '0000', requestId: 'red-bbbbbbbbbbbbbbbb' })).data.status, 'ALREADY_REDEEMED');
    assert.strictEqual((await demo.redeem({ ticketId, ticketToken, pin: '12', requestId: 'red-cccccccccccccccc' })).code, 'PIN_INVALID');
    assert.strictEqual((await demo.ticket(ticketId, ticketToken)).data.ticket.redeemed, true);
    assert.strictEqual(demo.demo, true);
    assert.strictEqual(fetchCalls, 0);
  } finally {
    global.fetch = realFetch;
  }
});

// ==== Round 2 review fixes (tag F1r; the spec-named F1 tests above stay at exactly 14) ====================
test('F1r submit: a second submit with another requestId while one is active writes nothing (stored pending stays A)', async () => {
  const clock = makeClock();
  const f = makeFetch([{ hang: true }]);
  const api = makeApi(f, clock);
  const s = memStorage();
  const T = 1712345678901;
  const content = QC.effectiveContent(null, DEFAULTS.embedded);
  const state = { eventId: 'a-day-2026', stage: 'quiz', entryType: 'card', answers: { q1: 'a' }, qIndex: 0 };
  const bodyA = QC.buildSubmitBody(state, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', 'b');
  const bodyB = QC.buildSubmitBody(state, content, 'dev-aaaaaaaaaaaaaaaa', 'req-bbbbbbbbbbbbbbbb', 'b');

  assert.strictEqual(api.busy('submit'), false);
  const first = QC.submitWithPending(api, s, state, bodyA, T);
  assert.strictEqual(api.busy('submit'), true);
  const second = await QC.submitWithPending(api, s, state, bodyB, T);
  assert.strictEqual(second.response.code, 'IN_FLIGHT');
  assert.strictEqual(second.response.action, 'none');
  assert.strictEqual(second.state, state, 'the caller state is returned untouched');
  assert.strictEqual(JSON.parse(s.getItem(QC.STORAGE_KEYS.state)).pending.requestId, 'req-aaaaaaaaaaaaaaaa');
  assert.strictEqual(f.calls.length, 1);
  assert.ok(first instanceof Promise);

  // an api without busy() (the demo api) still works
  const demo = QC.createDemoApi({ now: () => T });
  assert.strictEqual(demo.busy('submit'), false);
  const out = await QC.submitWithPending(demo, memStorage(), state, bodyA, T, { prefix: 'demo:' });
  assert.strictEqual(out.response.ok, true);
  const noBusy = { submit: () => Promise.resolve({ ok: true, data: { ticket: TICKET } }) };
  assert.strictEqual((await QC.submitWithPending(noBusy, memStorage(), state, bodyA, T)).response.ok, true);
});

test('F1r reset: a stored ticket decides by its own event; applyTicket records the ticket event', () => {
  const s = memStorage();
  const T = 1712345678901;
  // state.eventId came from the embedded content, the server issued the ticket under the phonetest event
  const stateEmbedded = { eventId: 'a-day-2026', stage: 'ticket', entryType: 'card', answers: {}, qIndex: 0, ticket: Object.assign({}, TICKET, { eventId: 'phonetest-1012' }) };
  QC.saveState(s, stateEmbedded, T);
  const keep = QC.resetForEvent(s, QC.loadState(s, T), 'phonetest-1012');
  assert.strictEqual(keep.reset, false, 'a fresh ticket is not wiped');
  assert.ok(keep.state.ticket);
  assert.notStrictEqual(s.getItem(QC.STORAGE_KEYS.state), null);
  assert.strictEqual(QC.resetForEvent(s, QC.loadState(s, T), 'a-day-2026').reset, true);

  const applied = QC.applyTicket({ eventId: 'a-day-2026', answers: {}, info: { name: 'x' }, pending: { requestId: 'r' } }, Object.assign({}, TICKET, { eventId: 'phonetest-1012' }));
  assert.strictEqual(applied.eventId, 'phonetest-1012');
  assert.strictEqual(applied.info, undefined);
  assert.strictEqual(applied.pending, undefined);
  assert.strictEqual(QC.applyTicket({ eventId: 'e1' }, { ticketId: 'x' }).eventId, 'e1');
});

test('F1r api: without AbortController a late success after the timeout is ignored; exactly one retry and one resolution', async () => {
  const clock = makeClock();
  const late = {};
  const calls = [];
  const okText = JSON.stringify(okEnv(CONFIG_DATA));
  const fetchFn = (url, init) => {
    calls.push({ url, init });
    const res = { ok: true, status: 200, text: () => Promise.resolve(okText) };
    if (calls.length === 1) { return new Promise((resolve) => { late.resolve = () => resolve(res); }); }
    return Promise.resolve(res);
  };
  const states = [];
  const api = QC.createApi({
    url: API, build: 'b', fetch: fetchFn, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, random: () => 0.5,
    now: clock.now, AbortController: null, onState: (s) => states.push(s.state + ':' + s.code)
  });
  let resolutions = 0;
  const p = api.config().then((r) => { resolutions += 1; return r; });
  await clock.advance(10000);
  assert.strictEqual(calls[0].init.signal, undefined, 'no signal without AbortController');
  assert.deepStrictEqual(states, ['sending:', 'waiting:TIMEOUT']);
  late.resolve(); // the first request finally succeeds, after its attempt already timed out
  await flush();
  assert.strictEqual(calls.length, 1, 'no extra request');
  await clock.advance(1500);
  assert.strictEqual(calls.length, 2, 'exactly one retry');
  const r = await p;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 2);
  await clock.advance(60000);
  assert.strictEqual(resolutions, 1);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(clock.count(), 0, 'no pending timers');
});

test('F1r api: a success with another apiVersion is BAD_RESPONSE; unknown server codes use the server retryable flag and message', async () => {
  const clock = makeClock();
  const f = makeFetch([{ json: { ok: true, apiVersion: 2, serverMs: 1, data: {} } }, { json: okEnv({ ticket: TICKET }) }]);
  const api = makeApi(f, clock);
  const p = api.ticket('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
  await clock.advance(0);
  assert.strictEqual(f.calls.length, 1);
  await clock.advance(2000);
  assert.strictEqual(f.calls.length, 2, 'BAD_RESPONSE is retried');
  assert.strictEqual((await p).ok, true);
  const noData = makeFetch([{ json: { ok: true, apiVersion: 3, serverMs: 1 } }]);
  const clockN = makeClock();
  const pn = makeApi(noData, clockN).ticket('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
  await clockN.advance(2000);
  assert.strictEqual((await pn).code, 'BAD_RESPONSE');

  // unknown code, not retryable: server message, one request
  const clock2 = makeClock();
  const f2 = makeFetch([{ json: { ok: false, apiVersion: 3, code: 'NEW_CODE', message: '서버 메시지', retryable: false } }]);
  const p2 = makeApi(f2, clock2).submit(SUBMIT_BODY);
  await clock2.advance(60000);
  const r2 = await p2;
  assert.deepStrictEqual([r2.code, r2.message, r2.retryable, f2.calls.length], ['NEW_CODE', '서버 메시지', false, 1]);
  // unknown code, retryable: retried
  const clock3 = makeClock();
  const f3 = makeFetch([{ json: { ok: false, apiVersion: 3, code: 'NEW_CODE', message: 'x', retryable: true } }, { json: okEnv({ ticket: TICKET }) }]);
  const p3 = makeApi(f3, clock3).submit(SUBMIT_BODY);
  await clock3.advance(1500);
  assert.strictEqual(f3.calls.length, 2);
  assert.strictEqual((await p3).ok, true);
  // client-only codes never ask the page to do anything
  const hung = makeApi(makeFetch([{ hang: true }]), makeClock());
  hung.submit(SUBMIT_BODY);
  assert.strictEqual((await hung.submit(Object.assign({}, SUBMIT_BODY, { requestId: 'req-bbbbbbbbbbbbbbbb' }))).action, 'none');
  assert.strictEqual((await makeApi(makeFetch([{ hang: true }]), makeClock()).retryNow('submit')).action, 'none');
  assert.strictEqual(QC.createDemoApi().retryNow('submit') instanceof Promise, true);
  assert.strictEqual((await QC.createDemoApi().retryNow('submit')).action, 'none');
});

test('F1r phone: normalization is the server normalizePhone_ (divergence vectors)', () => {
  assert.strictEqual(QC.normalizePhone('010.1234.5678'), '01012345678');
  assert.strictEqual(QC.normalizePhone('(010) 1234-5678'), '01012345678');
  assert.strictEqual(QC.normalizePhone("'01012345678"), '01012345678');
  assert.strictEqual(QC.normalizePhone('+82-10-1234-5678'), '01012345678');
  assert.strictEqual(QC.normalizePhone('+8201012345678'), '01012345678');
  assert.strictEqual(QC.normalizePhone('+ 82 10 1234 5678'), '', 'a space after the plus is not the +82 prefix: the server rejects it too');
  assert.strictEqual(QC.normalizePhone('82 10 1234 5678'), '');
  assert.strictEqual(QC.normalizePhone('010-1234-567a'), '');
  assert.strictEqual(QC.normalizePhone('010 1234 56789'), '');
  assert.strictEqual(QC.normalizePhone(1012345678), '');
});

test('F1r info: too-long fields use the client-only LENGTH code; email is capped at 254', () => {
  const good = { name: '테스트참가자', organization: '', phone: '010-0000-0001', email: '' };
  const yes = { required: true, marketing: false };
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { name: 'x'.repeat(41) }), yes, true), { ok: false, code: 'LENGTH', field: 'name' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { name: 'x'.repeat(40) }), yes, true).ok, true);
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { organization: 'x'.repeat(81) }), yes, true), { ok: false, code: 'LENGTH', field: 'organization' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { organization: 'x'.repeat(80) }), yes, true).ok, true);
  const longEmail = 'a'.repeat(250) + '@b.co'; // 255 characters
  assert.strictEqual(longEmail.length, 255);
  assert.deepStrictEqual(QC.validateInfo('info', Object.assign({}, good, { email: longEmail }), yes, true), { ok: false, code: 'INVALID_EMAIL', field: 'email' });
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { email: longEmail.slice(1) }), yes, true).ok, true);
  assert.strictEqual(QC.COPY.length, '입력한 내용이 너무 길어요. 줄여서 다시 입력해 주세요.');
  assert.strictEqual(QC.errorInfo('LENGTH'), null, 'LENGTH is not in the K1 table');
  assert.strictEqual(QC.validateInfo('info', Object.assign({}, good, { name: '' }), yes, true).code, 'REQUIRED_FIELDS');
});

test('F1r route: stage info wins, and an all-answered quiz lands on the last question', () => {
  const content = { questions: [{ id: 'q1' }, { id: 'q2' }] };
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'info', stage: 'info', info: { name: 'n' }, answers: { q1: 'a', q2: 'b' } }, content), { route: 'info' });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'info', answers: { q1: 'a' } }, content), { route: 'info' });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'quiz', answers: { q1: 'a', q2: 'b' } }, content), { route: 'quiz', qIndex: 1 });
  assert.deepStrictEqual(QC.routeOnLoad({ entryType: 'card', stage: 'quiz', answers: { q1: 'a' } }, { questions: [{ id: 'q1' }] }), { route: 'quiz', qIndex: 0 });
  assert.notStrictEqual(QC.routeOnLoad({ entryType: 'card', answers: { q1: 'a', q2: 'b' } }, content).route, 'saving');
  // a pending request still wins over stage info
  const body = { requestId: 'req-aaaaaaaaaaaaaaaa' };
  assert.deepStrictEqual(QC.routeOnLoad({ stage: 'info', entryType: 'card', answers: {}, pending: { requestId: body.requestId, body } }), { route: 'saving', resend: true });
});

test('F1r ticket: the stored redeemed flag survives the checking state', () => {
  const now = new Date(2026, 9, 14, 15, 3, 7);
  const usedTicket = Object.assign({}, TICKET, { redeemed: true, redeemedLabel: '15:10' });
  const vm = QC.ticketViewModel(usedTicket, now, { check: 'checking' });
  assert.strictEqual(vm.status, 'checking');
  assert.strictEqual(vm.statusText, '확인 중');
  assert.strictEqual(vm.redeemed, true);
  assert.strictEqual(QC.ticketViewModel(TICKET, now, { check: 'checking' }).redeemed, false);
});

test('F1r payload: entry type must be card or info; the consent version is the one stored with the state', () => {
  const content = QC.effectiveContent(null, DEFAULTS.embedded);
  ['', undefined, null, 'Card', 'both'].forEach((entryType) => {
    assert.throws(() => QC.buildSubmitBody({ entryType, answers: {} }, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', 'b'), /INVALID_ENTRY_TYPE/, String(entryType));
  });
  assert.throws(() => QC.buildSubmitBody(null, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', 'b'), /INVALID_ENTRY_TYPE/);
  const seen = { entryType: 'info', info: { name: 'n', phone: '010-0000-0001' }, consent: { required: true, marketing: false, version: 'seen-v1' }, answers: {} };
  assert.strictEqual(QC.buildSubmitBody(seen, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', 'b').consent.version, 'seen-v1');
  const noVersion = Object.assign({}, seen, { consent: { required: true, marketing: false } });
  assert.strictEqual(QC.buildSubmitBody(noVersion, content, 'dev-aaaaaaaaaaaaaaaa', 'req-aaaaaaaaaaaaaaaa', 'b').consent.version, 'a-day-2026-v1');
});

test('F1r storage: ticket fields are whitelisted; the draft v1 key is removed; a prefix keeps demo state apart', () => {
  const s = memStorage();
  const T = 1712345678901;
  const st = { eventId: 'a-day-2026', stage: 'ticket', entryType: 'card', answers: {}, ticket: Object.assign({}, TICKET, { demo: true, phone: '010-0000-0009', extra: 'x', pin: '1111' }) };
  QC.saveState(s, st, T);
  const t = JSON.parse(s.getItem(QC.STORAGE_KEYS.state)).ticket;
  assert.deepStrictEqual(Object.keys(t).sort(), ['demo', 'entryType', 'eventId', 'issuedAt', 'issuedLabel', 'redeemed', 'redeemedAt', 'redeemedLabel', 'ticketId', 'ticketLabel', 'ticketNo', 'ticketToken']);

  // draft v1 key is removed on load (also when there is no v3 state)
  const s2 = memStorage();
  s2.setItem('valen-quiz-v1', JSON.stringify({ entry: { name: '테스트참가자', phone: '010-0000-0001' } }));
  assert.strictEqual(QC.loadState(s2, T), null);
  assert.strictEqual(s2.getItem('valen-quiz-v1'), null);

  // demo namespace: separate keys, real keys and the draft key untouched
  const s3 = memStorage();
  s3.setItem('valen-quiz-v1', 'draft');
  const demo = { prefix: 'demo:' };
  const deviceReal = QC.getDeviceId(s3);
  QC.saveState(s3, { eventId: 'demo-preview', stage: 'quiz', entryType: 'card', answers: { q1: 'a' } }, T, demo);
  assert.strictEqual(s3.getItem(QC.STORAGE_KEYS.state), null, 'real state key untouched');
  const loaded = QC.loadState(s3, T, demo);
  assert.strictEqual(loaded.eventId, 'demo-preview');
  assert.strictEqual(s3.getItem('valen-quiz-v1'), 'draft', 'demo load never touches real keys');
  assert.strictEqual(QC.loadState(s3, T), null);
  assert.strictEqual(s3.getItem('valen-quiz-v1'), null, 'the real load removes the draft key');
  const demoDevice = QC.getDeviceId(s3, undefined, demo);
  assert.notStrictEqual(demoDevice, deviceReal);
  assert.strictEqual(s3.getItem('demo:' + QC.STORAGE_KEYS.device), demoDevice);
  assert.strictEqual(QC.resetForEvent(s3, loaded, 'a-day-2026', demo).reset, true);
  assert.strictEqual(s3.getItem('demo:' + QC.STORAGE_KEYS.state), null);
  assert.strictEqual(s3.getItem(QC.STORAGE_KEYS.device), deviceReal);
});

test('F1r grade: typographic quotes are removed like the server; punctuation-only answers never match', () => {
  const q = { type: 'text', accepted: ["Don't", 'say "hi"'] };
  assert.strictEqual(QC.gradeForDisplay(q, 'Don’t'), true);
  assert.strictEqual(QC.gradeForDisplay(q, 'Don‘t'), true);
  assert.strictEqual(QC.gradeForDisplay(q, '“say hi”'), true);
  assert.strictEqual(QC.gradeForDisplay(q, 'dont'), true);
  assert.strictEqual(QC.normalizeAnswerText('‘’“”'), '');
  // the empty-after-normalization guard: an accepted answer made only of removable characters must not match
  assert.strictEqual(QC.gradeForDisplay({ type: 'text', accepted: ['-', '.'] }, '?!'), false);
  assert.strictEqual(QC.gradeForDisplay({ type: 'text', accepted: ['-'] }, ''), false);
});

test('F1r public: source comments are English only (no Hangul in comment lines)', () => {
  ['quiz-core.js', 'defaults.js'].forEach((file) => {
    const lines = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) { assert.ok(!/[\uAC00-\uD7A3]/.test(line), file + ':' + (i + 1) + ' has Korean in a comment'); }
    });
  });
});

// ---- public repo hygiene -------------------------------------------------------------------------------
test('F1 public: quiz-core.js and defaults.js contain no /\\b1[A-Za-z0-9_-]{40,60}\\b/ id, no "246810" (spec C3: the Config key name staff_pin is allowed, the PIN value is not), no "?." or "??"', () => {
  ['quiz-core.js', 'defaults.js'].forEach((file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(src.length > 200, file + ' is not empty');
    assert.ok(!/\b1[A-Za-z0-9_-]{40,60}\b/.test(src), file + ' has a Sheet-id-like token');
    ['246810', '?.', '??', 'pushState', 'replaceState', 'google.script', 'location.', 'localStorage.', 'document.cookie'].forEach((needle) => {
      assert.strictEqual(src.toLowerCase().indexOf(needle.toLowerCase()), -1, file + ' contains ' + needle);
    });
    assert.ok(!/['"]0000['"]/.test(src), file + ' has no quoted test PIN');
  });
  // The only network address is the public exec URL in defaults.js, and no script id leaks into quiz-core.js.
  const core = fs.readFileSync(path.join(__dirname, '..', 'quiz-core.js'), 'utf8');
  assert.strictEqual(core.indexOf('script.google.com'), -1);
  assert.strictEqual(core.indexOf('AKfycby'), -1);
});

// ---- action-specific success payloads (review C24) ----------------------------------------------------
test('F1r api: a malformed success payload is BAD_RESPONSE and is retried inside the loop, per action', async () => {
  const T = (extra) => Object.assign({}, TICKET, extra);
  const goodTicket = { ticket: TICKET };
  const cases = [];
  const ticketVariants = [
    {}, { ticket: {} }, { ticket: null }, { ticket: T({ ticketId: 'short' }) }, { ticket: T({ ticketToken: 'x' }) }, { ticket: T({ ticketNo: 0 }) },
    { ticket: T({ ticketNo: 1.5 }) }, { ticket: T({ ticketNo: '42' }) }, { ticket: T({ redeemed: 'no' }) }, { ticket: T({ eventId: ' ' }) }
  ];
  ticketVariants.forEach((bad) => {
    cases.push(['submit', bad, goodTicket, (api) => api.submit(SUBMIT_BODY)]);
    cases.push(['ticket', bad, goodTicket, (api) => api.ticket('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb')]);
  });
  const goodRedeem = { status: 'REDEEMED', ticket: TICKET };
  [{ status: 'DONE', ticket: TICKET }, { status: 'REDEEMED' }, { status: 'REDEEMED', ticket: {} }, { ticket: TICKET }].forEach((bad) => {
    cases.push(['redeem', bad, goodRedeem, (api) => api.redeem({ ticketId: 'aaaaaaaaaaaaaaaa', ticketToken: 'bbbbbbbbbbbbbbbb', pin: '7391', requestId: 'req-aaaaaaaaaaaaaaaa' })]);
  });
  [{}, { eventId: 'a-day-2026' }, Object.assign({}, CONFIG_DATA, { registrationOpen: 'yes' }), Object.assign({}, CONFIG_DATA, { eventId: '' }),
    Object.assign({}, CONFIG_DATA, { infoPathReady: undefined }), Object.assign({}, CONFIG_DATA, { contentReady: 1 })].forEach((bad) => {
    cases.push(['config', bad, CONFIG_DATA, (api) => api.config()]);
  });
  for (const [action, bad, good, call] of cases) {
    const clock = makeClock();
    const f = makeFetch([{ json: okEnv(bad) }, { json: okEnv(good) }]);
    const p = call(makeApi(f, clock));
    await clock.advance(10000);
    const r = await p;
    const label = action + ' ' + JSON.stringify(bad);
    assert.strictEqual(r.ok, true, label + ': the second, valid answer is accepted');
    assert.strictEqual(f.calls.length, 2, label + ': the malformed answer was retried automatically');
    assert.strictEqual(r.attempts, 2, label);
    // and a valid answer needs no retry
    const f2 = makeFetch([{ json: okEnv(good) }]);
    const r2 = await call(makeApi(f2, makeClock()));
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(f2.calls.length, 1, label + ': a valid answer is taken at once');
  }
});

test('F1r storage: a malformed success is never stored as a ticket; the pending body stays until a valid ticket arrives', async () => {
  const clock = makeClock();
  const f = makeFetch([{ json: okEnv({ ticket: {} }) }]);
  const storage = memStorage();
  const st = QC.freshState('a-day-2026');
  st.entryType = 'card';
  const p = QC.submitWithPending(makeApi(f, clock), storage, st, SUBMIT_BODY, clock.now);
  await clock.advance(30000);
  const r = await p;
  assert.strictEqual(r.response.ok, false);
  assert.strictEqual(r.response.code, 'BAD_RESPONSE');
  assert.strictEqual(r.response.retryable, true);
  assert.strictEqual(f.calls.length, 4, 'four automatic attempts');
  assert.ok(f.calls.every((c) => c.body === f.calls[0].body), 'the identical body every time');
  const saved = JSON.parse(storage.m.get(QC.STORAGE_KEYS.state));
  assert.strictEqual(saved.ticket, undefined, 'no ticket stored');
  assert.strictEqual(saved.pending.requestId, SUBMIT_BODY.requestId);
  assert.deepStrictEqual(saved.pending.body, SUBMIT_BODY);
  // the manual retry with the stored body and a valid answer stores the ticket and drops the pending body
  const f2 = makeFetch([{ json: okEnv({ ticket: TICKET }) }]);
  const r2 = await QC.submitWithPending(makeApi(f2, makeClock()), storage, r.state, saved.pending.body, clock.now);
  assert.strictEqual(r2.response.ok, true);
  const saved2 = JSON.parse(storage.m.get(QC.STORAGE_KEYS.state));
  assert.strictEqual(saved2.ticket.ticketNo, 42);
  assert.strictEqual(saved2.pending, undefined);
});

test('F1r storage: acceptTicket is read when the answer arrives; a refused ticket is never written and the pending request stays', async () => {
  const TK = Object.assign({}, TICKET, { ticketId: 'zzzzzzzzzzzzzzzz', ticketToken: 'yyyyyyyyyyyyyyyy' }); // ids that appear nowhere else
  const writes = [];
  const storage = {
    m: new Map(),
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; },
    setItem(k, v) { writes.push(String(v)); this.m.set(k, String(v)); },
    removeItem(k) { this.m.delete(k); }
  };
  const st = QC.freshState('a-day-2026');
  st.entryType = 'card';
  let latest = ''; // the latest known config event, which changes while the request is in flight
  const opts = { acceptTicket: (t) => !latest || t.eventId === latest };
  const clock = makeClock();
  const f = makeFetch([{ json: okEnv({ ticket: TK }) }]);
  const p = QC.submitWithPending(makeApi(f, clock), storage, st, SUBMIT_BODY, clock.now, opts);
  latest = 'phonetest-1012'; // config B arrives before the answer
  const r = await p;
  assert.strictEqual(r.response.ok, false);
  assert.strictEqual(r.response.code, 'EVENT_CHANGED');
  assert.strictEqual(r.response.action, 'none');
  assert.strictEqual(r.state.ticket, undefined);
  assert.strictEqual(r.state.pending.requestId, SUBMIT_BODY.requestId, 'the pending request stays as it was stored');
  assert.ok(writes.length >= 1);
  assert.ok(writes.every((w) => w.indexOf(TK.ticketId) === -1 && w.indexOf(TK.ticketToken) === -1), 'no write ever contains the ticket');
  assert.strictEqual(JSON.parse(storage.m.get(QC.STORAGE_KEYS.state)).pending.requestId, SUBMIT_BODY.requestId);
  // the matching event: the ticket is stored exactly once
  writes.length = 0;
  latest = 'a-day-2026';
  const f2 = makeFetch([{ json: okEnv({ ticket: TK }) }]);
  const r2 = await QC.submitWithPending(makeApi(f2, makeClock()), storage, st, SUBMIT_BODY, clock.now, opts);
  assert.strictEqual(r2.response.ok, true);
  assert.strictEqual(writes.filter((w) => w.indexOf(TK.ticketId) !== -1).length, 1, 'stored once');
  assert.strictEqual(JSON.parse(storage.m.get(QC.STORAGE_KEYS.state)).pending, undefined);
});
