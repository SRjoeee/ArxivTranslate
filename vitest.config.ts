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
        },
      },
    },
    include: ['tests/**/*.test.ts'],
  },
})
