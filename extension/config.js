/*
 * 서버 주소 설정 — 공인 IP가 확정되면 채운다 (추측 금지, CLAUDE.md 규칙 5)
 *
 *   API_BASE: "http://<공인 IP>/wakeup/api"   ← 대시보드 측 Flask API (GET /profile/<code>)
 *   WEB_BASE: "http://<공인 IP>/wakeup/"      ← "웹에서 수정" 링크
 *
 * API_BASE를 채우면 manifest.json에도 추가해야 한다:
 *   "host_permissions": ["http://<공인 IP>/*"]
 *
 * 비어 있는 동안은 "예시 데이터로 보기"(sample-profile.json)만 동작한다.
 */
var WAKEUP_CONFIG = {
  API_BASE: "http://101.79.26.150/wakeup/api",
  WEB_BASE: "http://101.79.26.150/wakeup/"
};
