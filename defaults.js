/*
 * defaults.js - build id, public API address and the embedded fallback content for the Valen quiz page.
 *
 * How to open (Korean): 화면이 없는 설정 파일입니다. index.html 이 <script src="defaults.js?v=빌드">
 * 로 불러 window.VALEN_QUIZ_DEFAULTS 로 씁니다. 이 저장소는 공개이므로 비밀번호, 시트 ID, 스태프 PIN,
 * 실제 개인정보를 절대 넣지 않습니다. 실행 주소(exec URL)는 공개 값이라 넣어도 됩니다.
 *
 * Placeholders that start with "[입력 필요]" stay until slice F5 replaces them with the approved text.
 */
(function (root) {
  'use strict';
  var defaults = {
    build: '2026-10-08.1',
    apiUrl: 'https://script.google.com/macros/s/AKfycbygdI_wkT2lH7Dt3jm9HY4womEp9CznhEbeusgnbm350TjbEiUCS1_8fqwCwbwTcCulWQ/exec',
    embedded: {
      eventId: 'a-day-2026',
      contentVersion: 'embedded-2026-10-v1',
      consent: {
        version: 'a-day-2026-v1',
        collectedItems: '수집 항목: 이름, 휴대폰 번호, 소속(입력한 경우), 이메일(입력한 경우), 퀴즈 응답, 기기 식별값(중복 참여 방지용)',
        requiredDetail: '[입력 필요] 개인정보 수집·이용 안내',
        marketingDetail: '',
        privacyNoticeUrl: ''
      },
      questions: [
        {
          id: 'q1', order: 1, type: 'text',
          title: 'K-뷰티 성장의 핵심은 브랜드 인지도가 아니라\n국가별 OOO를 맞춘 히어로 SKU였습니다.',
          hint: 'ㅍㅇF',
          options: [], imageA: '', imageB: '', captionA: '', captionB: '',
          accepted: ['[입력 필요]'], correct: '', explanation: ''
        }
      ]
    }
  };
  if (typeof module === 'object' && module && module.exports) { module.exports = defaults; }
  if (typeof window !== 'undefined') { window.VALEN_QUIZ_DEFAULTS = defaults; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
