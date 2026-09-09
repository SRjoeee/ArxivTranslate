import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 测试环境自身的几条约束（issue #132）

const CONFIG = readFileSync(join(import.meta.dirname, '../../vitest.config.ts'), 'utf8')

describe('vitest 的 happy-dom 环境', () => {
  it('关掉主框架导航：单元测试不该产生任何网络意图', () => {
    // happy-dom 把 `location.hash = …` 当成一次跳转去 fetch，于是页内锚点的兜底（issue #44）在
    // 测试里变成对 http://localhost:3000/#tgt 的真实请求。本机与 CI 上碰巧是绿的（请求失败被吞掉），
    // 没网的沙箱里直接炸——Codex 审 #131 时就撞上了。真浏览器里同文档的片段跳转不发请求，
    // 所以这条设置是把 happy-dom 拉回真实行为。
    //
    // **只能这样断言。** 那次 fetch 走的是 happy-dom 内部的 Fetch，不经过 `window.fetch`，
    // 在测试里 spy 不到——第一版就是这么写的，去掉设置之后请求照发而测试照过。
    expect(CONFIG).toMatch(/navigation:\s*\{\s*disableMainFrameNavigation:\s*true\s*\}/)
  })

  it('不加载外链 CSS 与脚本，也不执行页面脚本', () => {
    for (const flag of ['disableCSSFileLoading', 'disableJavaScriptFileLoading', 'disableJavaScriptEvaluation']) {
      expect([flag, CONFIG.includes(`${flag}: true`)]).toEqual([flag, true])
    }
  })
})
