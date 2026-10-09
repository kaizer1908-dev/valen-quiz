/*
 * defaults.js - build id, public API address and the embedded fallback content for the Valen quiz page.
 *
 * How to use: this file has no UI. index.html loads it with <script src="defaults.js?v=BUILD"> and reads
 * window.VALEN_QUIZ_DEFAULTS. The repository is PUBLIC: never put passwords, Sheet IDs, the staff PIN or
 * real personal data here. The exec URL is public by nature and may be embedded.
 *
 * Placeholder values (the Korean "input needed" markers) stay until slice F5 replaces them with the approved text.
 */
(function (root) {
  'use strict';
  var defaults = {
    build: '2026-10-09.1',
    apiUrl: 'https://script.google.com/macros/s/AKfycbygdI_wkT2lH7Dt3jm9HY4womEp9CznhEbeusgnbm350TjbEiUCS1_8fqwCwbwTcCulWQ/exec',
    embedded: {
      eventId: 'a-day-2026',
      contentVersion: 'embedded-2026-10-v1',
      consent: {
        version: 'a-day-2026-v1',
        collectedItems: '수집 항목: 이름, 휴대폰 번호, 소속(입력한 경우), 이메일(입력한 경우), 퀴즈 응답, 기기 식별값(중복 참여 방지용)',
        // The team's text (it keeps its own separator dot); the collected-items line adds two items per spec C26.
        requiredDetail: '- 수집 항목 : 이름, 연락처, 이메일, 회사명·직책, 고민 유형·퀴즈 응답, 기기 식별값(중복 참여 방지용)\n- 이용 목적 이벤트 운영(참여 확인·경품 추첨)\n- 보유 기간 수집일로부터 1년 (목적 달성 시 지체 없이 파기)\n- 귀하는 개인정보 수집 및 이용에 대한 동의를 거부할 권리가 있습니다. 단, 필수 항목 동의 거부 시 이벤트 참여 및 경품 수령이 제한됩니다.',
        marketingDetail: '',
        privacyNoticeUrl: ''
      },
      questions: [
        {
          id: 'q1', order: 1, type: 'text',
          title: 'K-뷰티 성장의 핵심은 브랜드 인지도가 아니라\n국가별 OOO를 맞춘 히어로 SKU였습니다.',
          hint: 'ㅍㅇF',
          options: [], imageA: '', imageB: '', captionA: '', captionB: '',
          accepted: ['[입력 필요]'], correct: '', explanation: '80개 브랜드 데이터 기반으로 쌓은 Insight 와 Valen Agent 를 오후 5시에서 보실 수 있습니다.'
        }
      ]
    }
  };
  if (typeof module === 'object' && module && module.exports) { module.exports = defaults; }
  if (typeof window !== 'undefined') { window.VALEN_QUIZ_DEFAULTS = defaults; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
