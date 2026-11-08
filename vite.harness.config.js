// 브라우저 E2E 하네스용 vite 설정 — 패널을 목 chrome + 시드 데이터로 실제 브라우저에 마운트해
// 팝오버·spotlight 레이아웃을 육안/자동 검증한다. (확장 빌드용 vite.config.js와 분리)
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'test-harness',
  server: {
    port: 5199, strictPort: true,
    // affix.html 이 거래소 능력치 목록을 받는 길 — 브라우저에서 직접 부르면 CORS 에 막힌다(AGENTS.md 글로벌 지원 절)
    proxy: { '/trade2-api': { target: 'https://poe.kakaogames.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/trade2-api/, '/api'), headers: { 'User-Agent': 'Mozilla/5.0' } } },
  },
})
