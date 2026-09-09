import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

// WxtVitest：浏览器扩展 API 的内存实现、自动导入、@/ 别名
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    // fixture 里有外链 CSS / 脚本，测试环境一律不加载，也不执行页面脚本
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          handleDisabledFileLoadingAsSuccess: true,
          // 单元测试不该产生任何导航意图。happy-dom 把 `location.hash = …` 当成一次跳转去
          // fetch，于是页内锚点的兜底（issue #44）在测试里变成对 `http://localhost:3000/#tgt`
          // 的真实请求——本机与 CI 上碰巧是绿的，没网的沙箱里直接炸（Codex 审 #131 时撞上，issue #132）。
          // 真浏览器里同文档的片段跳转不发请求，所以这条是把 happy-dom 拉回真实行为，不是绕过测试
          navigation: { disableMainFrameNavigation: true },
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // fixture 级测试要遍历 1.8 MB 页面的全部元素，CI 机器上单例可达 6 s；默认 5 s 会误报
    testTimeout: 30_000,
  },
})
