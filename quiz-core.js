/*
 * quiz-core.js - pure logic for the Valen quiz page (contract K1 / K3, apiVersion 3).
 *
 * How to use: this file has no UI. In the browser index.html loads it with <script src="quiz-core.js">
 * and uses window.QuizCore. Run the tests in a terminal with `node --test test/quiz-core.test.js`.
 *
 * Rules: ES2017 only, no dependencies, no build step. Everything with side effects (fetch, timers,
 * storage, clock, randomness) is injected so the tests run without a network or a browser.
 * Nothing here touches the URL, and no PIN or secret is stored by this module.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.QuizCore = api; } else if (root && typeof root === 'object' && !(typeof module === 'object')) { root.QuizCore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var API_VERSION = 3;
  var ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
  var TTL_MS = 36 * 60 * 60 * 1000;
  var STORAGE_KEYS = { device: 'valen-quiz:device', state: 'valen-quiz:v3' };

  // K1 retry policy. timeout and backoff are in milliseconds; backoff[i] follows failed attempt i+1.
  var POLICY = {
    config: { timeout: 10000, attempts: 2, backoff: [1500] },
    submit: { timeout: 30000, attempts: 4, backoff: [1500, 3000, 6000] },
    ticket: { timeout: 12000, attempts: 2, backoff: [2000] },
    redeem: { timeout: 20000, attempts: 3, backoff: [1000, 3000] }
  };
  var JITTER = 0.3;

  // K1 error table. Messages are exact. `action` is what the page does with the code.
  var NET_COPY = '연결이 잠시 불안정해요. 자동으로 다시 시도할게요.';
  var ERROR_TABLE = {
    INVALID_REQUEST: { message: '요청 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.', retryable: false, action: 'error-card' },
    REGISTRATION_CLOSED: { message: '지금은 참여 접수 시간이 아니에요.', retryable: false, action: 'error-card-no-retry' },
    CONSENT_TEXT_MISSING: { message: "개인정보 동의 안내가 아직 준비되지 않았어요. 명함을 넣으셨다면 '명함을 명함함에 넣었어요'를 선택해 주세요.", retryable: false, action: 'back-to-info' },
    REQUIRED_FIELDS: { message: '이름과 휴대폰 번호를 입력해 주세요.', retryable: false, action: 'back-to-info' },
    INVALID_PHONE: { message: '휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)', retryable: false, action: 'back-to-info' },
    INVALID_EMAIL: { message: '이메일 형식을 확인해 주세요.', retryable: false, action: 'back-to-info' },
    CONSENT_REQUIRED: { message: '개인정보 수집·이용에 동의해야 참여할 수 있어요.', retryable: false, action: 'back-to-info' },
    INVALID_ANSWERS: { message: '답변 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.', retryable: false, action: 'error-card' },
    PARTICIPANT_LIMIT: { message: '준비된 참여 인원이 모두 찼어요. 부스 스태프에게 문의해 주세요.', retryable: false, action: 'error-card' },
    BUSY: { message: '참여자가 몰려 잠시 대기 중이에요. 자동으로 다시 시도할게요.', retryable: true, action: 'backoff' },
    SERVER_ERROR: { message: '서버가 잠시 응답하지 않아요. 자동으로 다시 시도할게요.', retryable: true, action: 'backoff' },
    TICKET_NOT_FOUND: { message: '응모권을 확인할 수 없어요. 부스 스태프에게 이 화면을 보여주세요.', retryable: false, action: 'ticket-unknown' },
    PIN_INVALID: { message: '확인 번호가 맞지 않아요.', retryable: false, action: 'staff-panel' },
    PIN_LOCKED: { message: '확인 번호 입력이 잠시 잠겼어요. 10분 후 다시 시도하거나 운영자에게 알려 주세요.', retryable: false, action: 'staff-panel' },
    NETWORK: { message: NET_COPY, retryable: true, action: 'backoff' },
    TIMEOUT: { message: NET_COPY, retryable: true, action: 'backoff' },
    BAD_RESPONSE: { message: NET_COPY, retryable: true, action: 'backoff' }
  };
  // The code and message name the Config key, not its value; the PIN itself never appears in this public file.
  ERROR_TABLE.STAFF_PIN_NOT_SET = {
    message: '스태프 확인 기능이 아직 설정되지 않았어요. (운영자: Config staff_pin)',
    retryable: false,
    action: 'staff-panel'
  };

  var COPY = {
    saving: '응모권을 발급하고 있어요',
    savingSlow: '사람이 많아 조금 걸리고 있어요. 이 화면을 닫지 말고 기다려 주세요.',
    submitExhausted: "연결이 잠시 불안정해요. 아래 '다시 시도'를 누르거나 부스 스태프에게 이 화면을 보여주세요.",
    length: '입력한 내용이 너무 길어요. 줄여서 다시 입력해 주세요.',
    existingPhone: '이 번호로 이미 발급된 응모권을 불러왔어요.',
    statusChecking: '확인 중',
    statusUnknown: '확인 불가',
    statusUnused: '스태프에게 이 화면을 보여주세요',
    statusUsedPrefix: '룰렛 참여 완료',
    recheck: '상태 다시 확인',
    demoWatermark: '미리보기 (사용 불가)'
  };

  // ---------------------------------------------------------------- small helpers
  function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toMs(now) {
    if (typeof now === 'function') { return now(); }
    if (now instanceof Date) { return now.getTime(); }
    if (typeof now === 'number') { return now; }
    return Date.now();
  }
  function hhmm(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function errorInfo(code) {
    return Object.prototype.hasOwnProperty.call(ERROR_TABLE, code) ? ERROR_TABLE[code] : null;
  }
  // Exact Korean copy for a code; unknown codes get the SERVER_ERROR copy.
  function errorCopy(code) {
    if (code === 'LENGTH') return COPY.length; // client-only validation code, outside the K1 table
    var info = errorInfo(code);
    return info ? info.message : ERROR_TABLE.SERVER_ERROR.message;
  }
  function failure(code, extra) {
    var info = errorInfo(code);
    var res = { ok: false, code: code, message: errorCopy(code), retryable: info ? info.retryable : false, action: info ? info.action : 'error-card' };
    if (extra) { Object.keys(extra).forEach(function (k) { res[k] = extra[k]; }); }
    return res;
  }
  // Text shown on the saving screen (K1 saving states).
  function savingText(attempt, max, elapsedMs) {
    if (attempt > 1) { return '다시 연결하고 있어요 (' + attempt + '/' + max + ')'; }
    return elapsedMs >= 8000 ? COPY.savingSlow : COPY.saving;
  }

  // ---------------------------------------------------------------- ids
  function formatUuid(bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (var i = 0; i < 16; i++) { hex.push((bytes[i] + 256).toString(16).slice(1)); }
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
  }
  // newId({crypto, random}): randomUUID, then getRandomValues, then Math.random. Always matches ID_PATTERN.
  function newId(env) {
    var e = env || {};
    var cr = e.crypto !== undefined ? e.crypto : (typeof crypto !== 'undefined' ? crypto : null);
    var rnd = typeof e.random === 'function' ? e.random : Math.random;
    var strategies = [
      function () { return cr && typeof cr.randomUUID === 'function' ? cr.randomUUID() : null; },
      function () {
        if (!cr || typeof cr.getRandomValues !== 'function') { return null; }
        var b = new Uint8Array(16);
        cr.getRandomValues(b);
        return formatUuid(b);
      },
      function () {
        var b = [];
        for (var i = 0; i < 16; i++) { b.push(Math.floor(rnd() * 256) & 255); }
        return formatUuid(b);
      }
    ];
    for (var i = 0; i < strategies.length; i++) {
      try {
        var id = strategies[i]();
        if (typeof id === 'string' && ID_PATTERN.test(id)) { return id; }
      } catch (err) { /* try the next strategy */ }
    }
    return formatUuid(new Array(16).fill(0)); // unreachable in practice; still a valid id
  }

  // ---------------------------------------------------------------- phone and info validation
  // Port of the server normalizePhone_ (Code.gs): NFKC, trim, a "+82" prefix becomes 0, strip non-digits, then
  // the same final pattern. Returns digits (01012345678) or "" when invalid. Keep it identical to the server (string inputs).
  function normalizePhone(value) {
    var cell = String(value === null || value === undefined ? '' : value);
    var digits = cell.normalize('NFKC').trim().replace(/^'/, '').trim()
      .replace(/^\+82[\s-]*0?/, '0').replace(/\D/g, '');
    return /^(?:010\d{8}|01[16789]\d{7,8})$/.test(digits) ? digits : '';
  }

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  // Mirrors the server order: gate, required fields, phone, email, consent. Card entries skip everything.
  function validateInfo(entryType, info, consent, infoPathReady) {
    if (entryType === 'card') { return { ok: true, code: '', field: '' }; }
    if (entryType !== 'info') { return { ok: false, code: 'INVALID_REQUEST', field: '' }; }
    var i = isObject(info) ? info : {};
    var name = str(i.name);
    var phoneText = str(i.phone);
    var email = str(i.email);
    if (infoPathReady !== true) { return { ok: false, code: 'CONSENT_TEXT_MISSING', field: 'consent' }; }
    if (name === '') { return { ok: false, code: 'REQUIRED_FIELDS', field: 'name' }; }
    if (phoneText === '') { return { ok: false, code: 'REQUIRED_FIELDS', field: 'phone' }; }
    // Too long is a client-only code (copy in COPY.length), not part of the K1 table.
    if (name.length > 40) { return { ok: false, code: 'LENGTH', field: 'name' }; }
    if (str(i.organization).length > 80) { return { ok: false, code: 'LENGTH', field: 'organization' }; }
    if (normalizePhone(phoneText) === '') { return { ok: false, code: 'INVALID_PHONE', field: 'phone' }; }
    if (email !== '' && (email.length > 254 || !EMAIL_PATTERN.test(email))) { return { ok: false, code: 'INVALID_EMAIL', field: 'email' }; }
    if (!isObject(consent) || consent.required !== true) { return { ok: false, code: 'CONSENT_REQUIRED', field: 'consent' }; }
    return { ok: true, code: '', field: '' };
  }

  // ---------------------------------------------------------------- content and grading
  function consentUsable(consent) {
    return isObject(consent) && !isBlank(consent.requiredDetail) && String(consent.requiredDetail).indexOf('[입력 필요]') !== 0;
  }

  // Server questions only when contentReady is true AND the list is non-empty; otherwise the embedded copy.
  function effectiveContent(serverData, embedded) {
    var emb = embedded || {};
    var srv = isObject(serverData) ? serverData : null;
    var useServerQuestions = !!(srv && srv.contentReady === true && Array.isArray(srv.questions) && srv.questions.length > 0);
    var srvConsent = srv && isObject(srv.consent) && !isBlank(srv.consent.requiredDetail) ? srv.consent : null;
    return {
      source: useServerQuestions ? 'server' : 'embedded',
      eventId: srv && typeof srv.eventId === 'string' && srv.eventId ? srv.eventId : emb.eventId,
      contentVersion: useServerQuestions ? srv.contentVersion : emb.contentVersion,
      registrationOpen: srv ? srv.registrationOpen !== false : true,
      infoPathReady: srv ? (srv.infoPathReady === true && !!srvConsent) : consentUsable(emb.consent),
      questions: useServerQuestions ? srv.questions : (emb.questions || []),
      consent: srvConsent || emb.consent || null
    };
  }

  // K3 normalization: NFKC, lowercase, then drop whitespace and . , ! ? middle-dot ' " - plus the typographic
  // quotes U+2018/2019/201C/201D (iPhone smart punctuation), identical to the server normalizeAnswerText_.
  function normalizeAnswerText(v) {
    return String(v === null || v === undefined ? '' : v).normalize('NFKC').toLowerCase().replace(/[\s.,!?·'"‘’“”-]+/g, '');
  }
  // true / false, or "" when the question has no right answer.
  function gradeForDisplay(question, value) {
    var q = question || {};
    if (q.type === 'text') {
      var got = normalizeAnswerText(value);
      if (got === '') { return false; }
      var accepted = Array.isArray(q.accepted) ? q.accepted : [];
      for (var i = 0; i < accepted.length; i++) {
        if (normalizeAnswerText(accepted[i]) === got) { return true; }
      }
      return false;
    }
    if (q.type === 'choice' || q.type === 'ab') {
      if (isBlank(q.correct)) { return ''; }
      return String(value) === String(q.correct);
    }
    return '';
  }

  // ---------------------------------------------------------------- request body
  // The body is built once and stored as `pending`, so every attempt sends exactly the same bytes.
  // Throws Error('INVALID_ENTRY_TYPE') unless state.entryType is exactly 'card' or 'info' (a missing type must
  // never silently become a card ticket).
  function buildSubmitBody(state, content, deviceId, requestId, build) {
    var st = state || {};
    var entryType = st.entryType;
    if (entryType !== 'card' && entryType !== 'info') { throw new Error('INVALID_ENTRY_TYPE'); }
    var body = {
      action: 'submit',
      apiVersion: API_VERSION,
      requestId: requestId,
      deviceId: deviceId,
      entryType: entryType,
      info: null,
      consent: null,
      contentVersion: content.contentVersion,
      answers: [],
      build: build
    };
    if (entryType === 'info') {
      var i = st.info || {};
      body.info = { name: str(i.name), organization: str(i.organization), phone: str(i.phone), email: str(i.email) };
      body.consent = {
        required: !!(st.consent && st.consent.required === true),
        marketing: !!(st.consent && st.consent.marketing === true),
        // The version of the text the person actually saw (stored with the state), else the current content's.
        version: (st.consent && st.consent.version) || (content.consent ? content.consent.version : '')
      };
    }
    var answers = st.answers || {};
    (content.questions || []).forEach(function (q) {
      var v = answers[q.id];
      if (v !== undefined && v !== null && String(v) !== '') {
        body.answers.push({ questionId: q.id, value: String(v).slice(0, 100) });
      }
    });
    return body;
  }

  // ---------------------------------------------------------------- API client
  // A success payload is checked by action INSIDE the attempt: a malformed one is BAD_RESPONSE (retryable), so
  // the retry loop, the stored pending body and the ticket rules never see data the page cannot use.
  function validTicket(t) {
    return isObject(t) && typeof t.ticketId === 'string' && ID_PATTERN.test(t.ticketId) &&
      typeof t.ticketToken === 'string' && ID_PATTERN.test(t.ticketToken) &&
      typeof t.eventId === 'string' && t.eventId.trim() !== '' &&
      typeof t.ticketNo === 'number' && Number.isInteger(t.ticketNo) && t.ticketNo > 0 && typeof t.redeemed === 'boolean';
  }
  function validPayload(action, d) {
    if (action === 'submit' || action === 'ticket') { return validTicket(d.ticket); }
    if (action === 'redeem') { return (d.status === 'REDEEMED' || d.status === 'ALREADY_REDEEMED') && validTicket(d.ticket); }
    if (action === 'config') {
      return typeof d.eventId === 'string' && d.eventId.trim() !== '' && typeof d.registrationOpen === 'boolean' &&
        typeof d.infoPathReady === 'boolean' && typeof d.contentReady === 'boolean';
    }
    return true;
  }
  function parseEnvelope(text, action) {
    var env;
    try { env = JSON.parse(text); } catch (e) { return failure('BAD_RESPONSE'); }
    if (!isObject(env) || typeof env.ok !== 'boolean') { return failure('BAD_RESPONSE'); }
    if (env.ok) {
      if (env.apiVersion !== API_VERSION || !isObject(env.data) || !validPayload(action, env.data)) { return failure('BAD_RESPONSE'); }
      return { ok: true, data: env.data, serverMs: env.serverMs };
    }
    var code = typeof env.code === 'string' && env.code ? env.code : 'SERVER_ERROR';
    var known = errorInfo(code);
    if (known) { return failure(code); }
    // Unknown server code: trust the server's retryable flag and its own message.
    var res = failure('SERVER_ERROR');
    res.code = code;
    res.retryable = env.retryable === true;
    res.action = res.retryable ? 'backoff' : 'error-card';
    if (!res.retryable && typeof env.message === 'string' && env.message) { res.message = env.message; }
    return res;
  }

  function createApi(opts) {
    var o = opts || {};
    var apiUrl = o.url;
    var build = o.build === undefined ? '' : String(o.build);
    var fetchFn = o.fetch || (typeof fetch === 'function' ? function (u, i) { return fetch(u, i); } : null);
    var setT = o.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var clearT = o.clearTimeout || function (id) { return clearTimeout(id); };
    var random = typeof o.random === 'function' ? o.random : Math.random;
    var nowFn = typeof o.now === 'function' ? o.now : Date.now;
    var AC = o.AbortController !== undefined ? o.AbortController : (typeof AbortController !== 'undefined' ? AbortController : null);

    var ops = {};   // action -> the run that is in flight or waiting for its next attempt
    var last = {};  // action -> request of the last run that failed with a retryable error (for retryNow)
    var api = { onState: typeof o.onState === 'function' ? o.onState : null };

    function emit(action, state, attempt, max, code) {
      if (typeof api.onState !== 'function') { return; }
      try { api.onState({ action: action, state: state, attempt: attempt, max: max, code: code || '' }); } catch (e) { /* UI errors must not break retries */ }
    }

    // One attempt. Always resolves to a result object, never rejects.
    function attemptOnce(request, timeoutMs, action) {
      return new Promise(function (resolve) {
        var done = false;
        var timer = null;
        var ctl = AC ? new AC() : null;
        function finish(r) {
          if (done) { return; }
          done = true;
          clearT(timer);
          resolve(r);
        }
        timer = setT(function () {
          if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
          finish(failure('TIMEOUT'));
        }, timeoutMs);
        var init = { method: request.method, credentials: 'omit', redirect: 'follow', cache: 'no-store' };
        if (request.body !== null) { init.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; init.body = request.body; }
        if (ctl) { init.signal = ctl.signal; }
        var p;
        try { p = fetchFn(request.url, init); } catch (e) { finish(failure('NETWORK')); return; }
        Promise.resolve(p)
          .then(function (res) { return res.text(); })
          .then(function (text) { finish(parseEnvelope(text, action)); }, function () { finish(failure('NETWORK')); });
      });
    }

    function delayFor(policy, attempt) {
      var base = policy.backoff[Math.min(attempt - 1, policy.backoff.length - 1)];
      return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
    }

    function startRun(action, request, key) {
      var policy = POLICY[action];
      var op = { key: key, request: request, attempt: 0, timer: null, wake: null, promise: null, startedAt: nowFn() };
      ops[action] = op;
      op.promise = new Promise(function (resolve) {
        function next() {
          op.attempt += 1;
          emit(action, 'sending', op.attempt, policy.attempts);
          attemptOnce(request, policy.timeout, action).then(function (r) {
            r.attempts = op.attempt;
            r.elapsedMs = nowFn() - op.startedAt;
            if (r.ok) { resolve(r); return; }
            if (!r.retryable) { emit(action, 'failed', op.attempt, policy.attempts, r.code); resolve(r); return; }
            if (op.attempt >= policy.attempts) {
              r.exhausted = true;
              emit(action, 'failed', op.attempt, policy.attempts, r.code);
              resolve(r);
              return;
            }
            var delay = delayFor(policy, op.attempt);
            emit(action, 'waiting', op.attempt, policy.attempts, r.code);
            op.wake = function () { clearT(op.timer); op.wake = null; next(); };
            op.timer = setT(op.wake, delay);
          });
        }
        next();
      }).then(function (res) {
        delete ops[action];
        if (!res.ok && res.retryable) { last[action] = { request: request, key: key }; } else { delete last[action]; }
        return res;
      });
      return op.promise;
    }

    // Single-flight: the same request while one is active returns the active promise; a different one is refused.
    function run(action, request) {
      var key = request.method + ' ' + request.url + ' ' + (request.body || '');
      var cur = ops[action];
      if (cur) { return cur.key === key ? cur.promise : Promise.resolve(failure('IN_FLIGHT', { message: '', action: 'none' })); }
      return startRun(action, request, key);
    }

    function post(action, body) {
      var payload = Object.assign({ action: action, apiVersion: API_VERSION }, body || {});
      return run(action, { method: 'POST', url: apiUrl, body: JSON.stringify(payload) });
    }

    api.config = function () {
      return run('config', { method: 'GET', url: apiUrl + '?action=config&v=' + encodeURIComponent(build), body: null });
    };
    api.submit = function (body) { return post('submit', body); };
    api.ticket = function (id, token) { return post('ticket', { ticketId: id, ticketToken: token }); };
    api.redeem = function (body) { return post('redeem', body); };
    // retryNow: skip a pending backoff, or re-send the last exhausted request with the same body (same requestId).
    api.retryNow = function (action) {
      var cur = ops[action];
      if (cur) {
        if (cur.wake) { cur.wake(); }
        return cur.promise;
      }
      var prev = last[action];
      if (prev) { return startRun(action, prev.request, prev.key); }
      return Promise.resolve(failure('NOTHING_TO_RETRY', { message: '', action: 'none' }));
    };
    // True while a request for this action is in flight or waiting for its next attempt.
    api.busy = function (action) { return !!ops[action]; };
    return api;
  }

  // In-memory stand-in for ?demo=1. Never calls fetch; every ticket is flagged demo:true.
  function createDemoApi(opts) {
    var o = opts || {};
    var nowFn = typeof o.now === 'function' ? o.now : Date.now;
    var tickets = {};
    var byRequest = {};
    var byDevice = {};
    var byPhone = {};
    var count = 0;
    function ok(data) { return Promise.resolve({ ok: true, data: data, serverMs: 0, attempts: 1 }); }
    function bad(code) { return Promise.resolve(failure(code, { attempts: 1 })); }
    function view(t) { return Object.assign({}, t.ticket); }
    var api = {
      demo: true,
      onState: null,
      config: function () {
        return ok({
          eventId: 'demo-preview', eventName: 'Valen 행운퀴즈', registrationOpen: true, infoPathReady: true,
          contentVersion: 'demo', contentReady: false, questions: null,
          consent: { version: 'demo', collectedItems: '', requiredDetail: '[입력 필요] 미리보기용 안내입니다.', marketingDetail: '', privacyNoticeUrl: '' }
        });
      },
      submit: function (body) {
        var b = body || {};
        var hit = byRequest[b.requestId];
        var existing = '';
        if (!hit && b.entryType === 'info' && b.info && byPhone[normalizePhone(b.info.phone)]) { hit = byPhone[normalizePhone(b.info.phone)]; existing = 'PHONE'; }
        if (!hit && b.entryType === 'card' && byDevice[b.deviceId]) { hit = byDevice[b.deviceId]; existing = 'DEVICE'; }
        if (hit) { return ok({ ticket: view(hit), repeated: existing === '', existing: existing, timing: { lockWaitMs: 0, lockHoldMs: 0 } }); }
        count += 1;
        var issuedAt = new Date(nowFn()).toISOString();
        var suffix = count + '-demo-preview'; // keeps the id inside the 16-64 character id pattern
        var rec = { requests: {}, ticket: {
          ticketId: 'demo-ticket-' + suffix, ticketToken: 'demo-token-' + suffix, ticketNo: count,
          ticketLabel: 'No. ' + String(count).padStart(3, '0'), eventId: 'demo-preview', entryType: b.entryType === 'info' ? 'info' : 'card',
          issuedAt: issuedAt, issuedLabel: hhmm(issuedAt), redeemed: false, redeemedAt: '', redeemedLabel: '', demo: true
        } };
        tickets[rec.ticket.ticketId] = rec;
        byRequest[b.requestId] = rec;
        if (b.entryType === 'card') { byDevice[b.deviceId] = rec; } else if (b.info) { byPhone[normalizePhone(b.info.phone)] = rec; }
        return ok({ ticket: view(rec), repeated: false, existing: '', timing: { lockWaitMs: 0, lockHoldMs: 0 } });
      },
      ticket: function (id, token) {
        var rec = tickets[id];
        return rec && rec.ticket.ticketToken === token ? ok({ ticket: view(rec) }) : bad('TICKET_NOT_FOUND');
      },
      redeem: function (body) {
        var b = body || {};
        var rec = tickets[b.ticketId];
        if (!rec || rec.ticket.ticketToken !== b.ticketToken) { return bad('TICKET_NOT_FOUND'); }
        var pin = String(b.pin === undefined || b.pin === null ? '' : b.pin);
        if (pin.length < 4 || pin.length > 12) { return bad('PIN_INVALID'); }
        var t = rec.ticket;
        var status = 'REDEEMED';
        if (!t.redeemed) {
          var at = new Date(nowFn()).toISOString();
          t.redeemed = true; t.redeemedAt = at; t.redeemedLabel = hhmm(at); rec.requests[b.requestId] = true;
        } else if (!rec.requests[b.requestId]) { status = 'ALREADY_REDEEMED'; }
        return ok({ status: status, ticket: view(rec), timing: { lockWaitMs: 0, lockHoldMs: 0 } });
      },
      busy: function () { return false; },
      retryNow: function () { return Promise.resolve(failure('NOTHING_TO_RETRY', { message: '', action: 'none' })); }
    };
    return api;
  }

  // ---------------------------------------------------------------- device storage
  var DRAFT_V1_KEY = 'valen-quiz-v1'; // draft v1 stored personal fields on devices that tried it; removed on load
  var TICKET_FIELDS = ['ticketId', 'ticketToken', 'ticketNo', 'ticketLabel', 'eventId', 'entryType', 'issuedAt', 'issuedLabel',
    'redeemed', 'redeemedAt', 'redeemedLabel', 'demo'];

  function sGet(storage, key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } }
  function sSet(storage, key, value) { try { if (!storage) { return false; } storage.setItem(key, value); return true; } catch (e) { return false; } }
  function sRemove(storage, key) { try { if (storage) { storage.removeItem(key); } } catch (e) { /* ignore */ } }

  // Storage keys. opts.prefix (for example "demo:") keeps ?demo=1 state out of the real keys.
  function storageKeys(opts) {
    var p = opts && typeof opts.prefix === 'string' ? opts.prefix : '';
    return { device: p + STORAGE_KEYS.device, state: p + STORAGE_KEYS.state, prefixed: p !== '' };
  }

  // Persistent device id. If storage is blocked the new id still works for this tab (caller keeps it in memory).
  function getDeviceId(storage, env, opts) {
    var key = storageKeys(opts).device;
    var stored = sGet(storage, key);
    if (typeof stored === 'string' && ID_PATTERN.test(stored)) { return stored; }
    var id = newId(env);
    sSet(storage, key, id);
    return id;
  }

  function freshState(eventId) {
    return { v: 3, eventId: eventId || '', stage: 'landing', entryType: '', answers: {}, qIndex: 0 };
  }

  function sanitizeTicket(ticket) {
    var out = {};
    TICKET_FIELDS.forEach(function (k) { if (ticket[k] !== undefined) { out[k] = ticket[k]; } });
    return out;
  }

  // Only whitelisted keys reach storage, so a PIN (or any stray field) can never be persisted.
  // Once a ticket exists, personal info and the pending request are dropped.
  function sanitizeForStorage(state, nowMs) {
    var s = state || {};
    var out = {
      v: 3, savedAt: nowMs, eventId: s.eventId || '', stage: s.stage || 'landing', entryType: s.entryType || '',
      answers: isObject(s.answers) ? s.answers : {}, qIndex: s.qIndex | 0
    };
    if (isObject(s.consent)) {
      out.consent = { required: s.consent.required === true, marketing: s.consent.marketing === true, version: s.consent.version || '' };
    }
    if (isObject(s.ticket)) {
      out.ticket = sanitizeTicket(s.ticket);
    } else {
      if (isObject(s.info)) { out.info = { name: str(s.info.name), organization: str(s.info.organization), phone: str(s.info.phone), email: str(s.info.email) }; }
      if (isObject(s.pending)) { out.pending = { requestId: s.pending.requestId, body: s.pending.body }; }
    }
    return out;
  }

  function saveState(storage, state, now, opts) {
    try { return sSet(storage, storageKeys(opts).state, JSON.stringify(sanitizeForStorage(state, toMs(now)))); } catch (e) { return false; }
  }

  // Returns the stored state, or null when missing, corrupt, wrong version or older than 36 h.
  // Without a prefix it also deletes the draft v1 key.
  function loadState(storage, now, opts) {
    var keys = storageKeys(opts);
    if (!keys.prefixed) { sRemove(storage, DRAFT_V1_KEY); }
    var raw = sGet(storage, keys.state);
    if (!raw) { return null; }
    var s;
    try { s = JSON.parse(raw); } catch (e) { s = null; }
    if (!isObject(s) || s.v !== 3 || typeof s.savedAt !== 'number' || toMs(now) - s.savedAt > TTL_MS) {
      sRemove(storage, keys.state);
      return null;
    }
    if (!isObject(s.answers)) { s.answers = {}; }
    if (isObject(s.ticket)) { delete s.info; delete s.pending; }
    return s;
  }

  // When config.eventId differs from the stored event, progress and ticket are cleared; the device id key is
  // never touched. A stored ticket decides by its own eventId (state.eventId may come from the embedded content
  // and be older than the ticket); without a ticket state.eventId decides. Returns {state, reset}.
  function resetForEvent(storage, state, configEventId, opts) {
    if (!state || !configEventId) { return { state: state || null, reset: false }; }
    var stored = isObject(state.ticket) && state.ticket.eventId ? state.ticket.eventId : state.eventId;
    if (!stored || stored === configEventId) {
      if (!state.eventId) { state.eventId = configEventId; }
      return { state: state, reset: false };
    }
    sRemove(storage, storageKeys(opts).state);
    return { state: freshState(configEventId), reset: true };
  }

  function applyTicket(state, ticket) {
    var next = Object.assign({}, state, { ticket: ticket, stage: 'ticket', eventId: ticket.eventId || state.eventId });
    delete next.info;
    delete next.pending;
    return next;
  }

  // Writes `pending` (requestId + exact body) to storage BEFORE the first send, then submits.
  // Resolves {response, state}. On success the ticket is stored and info/pending are dropped.
  // If a submit is already active (api.busy), nothing is written: the stored pending of the active request stays.
  function submitWithPending(api, storage, state, body, now, opts) {
    if (typeof api.busy === 'function' && api.busy('submit')) {
      return Promise.resolve({ response: failure('IN_FLIGHT', { message: '', action: 'none' }), state: state });
    }
    var pending = Object.assign({}, state, { stage: 'saving', pending: { requestId: body.requestId, body: body } });
    saveState(storage, pending, now, opts);
    return api.submit(body).then(function (res) {
      var next = pending;
      if (!res.ok && res.action === 'none') {
        return { response: res, state: state }; // api without busy(): do not touch storage again
      }
      if (res.ok && isObject(res.data.ticket)) {
        next = applyTicket(pending, res.data.ticket);
      } else if (res.ok) {
        res = failure('BAD_RESPONSE', { attempts: res.attempts });
      } else if (!res.retryable) {
        // The server wrote nothing: forget the request so the next submit gets a NEW requestId.
        next = Object.assign({}, pending, { stage: res.action === 'back-to-info' ? 'info' : 'quiz' });
        delete next.pending;
      }
      saveState(storage, next, now, opts);
      return { response: res, state: next };
    });
  }

  // ---------------------------------------------------------------- reload routing and ticket view
  // content (optional) lets the quiz resume at the first unanswered question, or at the last question when all
  // are answered but nothing was sent (the page shows the locked answer and the "get ticket" button).
  // The page must set state.stage when it moves between steps: stage "info" always routes to the info step.
  function routeOnLoad(state, content) {
    if (!state) { return { route: 'landing' }; }
    if (isObject(state.ticket)) { return { route: 'ticket' }; }
    if (isObject(state.pending) && state.pending.requestId && isObject(state.pending.body)) { return { route: 'saving', resend: true }; }
    if (state.stage === 'info') { return { route: 'info' }; }
    if (state.entryType !== 'card' && state.entryType !== 'info') { return { route: 'landing' }; }
    if (state.entryType === 'info' && !isObject(state.info)) { return { route: 'info' }; }
    var answers = state.answers || {};
    if (content && Array.isArray(content.questions) && content.questions.length > 0) {
      for (var i = 0; i < content.questions.length; i++) {
        if (isBlank(answers[content.questions[i].id])) { return { route: 'quiz', qIndex: i }; }
      }
      return { route: 'quiz', qIndex: content.questions.length - 1 };
    }
    return { route: 'quiz', qIndex: state.qIndex | 0 };
  }

  // opts.check: "checking" | "not_found" | "unreachable" (the ticket call result); opts.existing: "PHONE" | "DEVICE" | "".
  function ticketViewModel(ticket, now, opts) {
    var t = ticket || {};
    var o = opts || {};
    var d = new Date(toMs(now));
    var label = t.ticketLabel || (isBlank(t.ticketNo) ? '' : 'No. ' + String(t.ticketNo).padStart(3, '0'));
    var issuedLabel = t.issuedLabel || hhmm(t.issuedAt);
    var redeemedLabel = t.redeemedLabel || hhmm(t.redeemedAt);
    var status = t.redeemed === true ? 'used' : 'unused';
    if (o.check === 'checking') { status = 'checking'; }
    if (o.check === 'not_found') { status = 'unknown'; }
    var statusText = {
      unused: COPY.statusUnused,
      used: COPY.statusUsedPrefix + (redeemedLabel ? ' (' + redeemedLabel + ')' : ''),
      unknown: COPY.statusUnknown,
      checking: COPY.statusChecking
    }[status];
    return {
      label: label,
      issuedLabel: issuedLabel,
      issuedText: issuedLabel ? '발급 ' + issuedLabel : '',
      redeemed: t.redeemed === true, // the stored flag is kept while the status is being checked
      redeemedLabel: redeemedLabel,
      status: status,
      statusText: statusText,
      showRecheck: o.check === 'unreachable',
      recheckText: COPY.recheck,
      note: o.existing === 'PHONE' ? COPY.existingPhone : '',
      clockText: '지금 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()),
      demo: t.demo === true,
      demoWatermark: t.demo === true ? COPY.demoWatermark : ''
    };
  }

  return {
    API_VERSION: API_VERSION, ID_PATTERN: ID_PATTERN, TTL_MS: TTL_MS, STORAGE_KEYS: STORAGE_KEYS, POLICY: POLICY,
    ERROR_TABLE: ERROR_TABLE, COPY: COPY,
    createApi: createApi, createDemoApi: createDemoApi, newId: newId, normalizePhone: normalizePhone,
    validateInfo: validateInfo, buildSubmitBody: buildSubmitBody, effectiveContent: effectiveContent,
    normalizeAnswerText: normalizeAnswerText, gradeForDisplay: gradeForDisplay,
    getDeviceId: getDeviceId, storageKeys: storageKeys, freshState: freshState, loadState: loadState, saveState: saveState,
    resetForEvent: resetForEvent, applyTicket: applyTicket, submitWithPending: submitWithPending,
    routeOnLoad: routeOnLoad, ticketViewModel: ticketViewModel, errorCopy: errorCopy, errorInfo: errorInfo,
    savingText: savingText
  };
});
