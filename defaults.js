/*
 * defaults.js - build id, public API address and the embedded fallback content for the Valen quiz page.
 *
 * How to use: this file has no UI. index.html loads it with <script src="defaults.js?v=BUILD"> and reads
 * window.VALEN_QUIZ_DEFAULTS. The repository is PUBLIC: never put passwords, Sheet IDs, PINs or
 * real personal data here. The exec URL is public by nature and may be embedded.
 */
(function (root) {
  'use strict';
  var defaults = {
    build: '2026-10-12.1',
    apiUrl: 'https://script.google.com/macros/s/AKfycbygdI_wkT2lH7Dt3jm9HY4womEp9CznhEbeusgnbm350TjbEiUCS1_8fqwCwbwTcCulWQ/exec',
    embedded: {
      eventId: 'a-day-2026',
      contentVersion: 'embedded-2026-10-v1',
      consent: {
        version: 'a-day-2026-v3',
        collectedItems: '수집 항목: 이름, 휴대폰 번호, 소속(입력한 경우), 이메일(입력한 경우), 기기 식별값(중복 참여 방지용)',
        // The team's text (it keeps its own separator dot); the collected-items line follows spec C28 (no quiz answer).
        requiredDetail: '- 수집 항목 : 이름, 연락처, 이메일, 회사명·직책, 고민 유형, 기기 식별값(중복 참여 방지용)\n- 이용 목적 이벤트 운영(참여 확인·경품 추첨)\n- 보유 기간 수집일로부터 1년 (목적 달성 시 지체 없이 파기)\n- 귀하는 개인정보 수집 및 이용에 대한 동의를 거부할 권리가 있습니다. 단, 필수 항목 동의 거부 시 이벤트 참여 및 경품 수령이 제한됩니다.',
        marketingDetail: '',
        privacyNoticeUrl: ''
      },
      questions: [
        {
          id: 'q1', order: 1, type: 'text',
          title: "만드는 것이 어려운 시대는 이미 지났습니다.\n'어떻게 OOO를 만들지' 정하는 것이 남은 경쟁입니다.",
          hint: 'ㅊㅂㅎ (3글자)',
          options: [], imageA: '', imageB: '', captionA: '', captionB: '',
          accepted: ['차별화'], correct: '', explanation: '80개 브랜드 데이터 기반으로 쌓은 Insight 와 Valen Agent 를 오후 5시에서 보실 수 있습니다.'
        }
      ]
    }
  };
  if (typeof module === 'object' && module && module.exports) { module.exports = defaults; }
  if (typeof window !== 'undefined') { window.VALEN_QUIZ_DEFAULTS = defaults; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
