'use strict';
/*
 * Static checks of index.html (slice F2). No browser and no DOM library: the page is read as text,
 * and its inline scripts are compiled with node:vm to prove they parse.
 * Run (Korean): node --test test/page.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULTS = require('../defaults.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

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
const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, '');

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
  });
});
