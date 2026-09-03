// 注入 arxiv.org/html/*。Phase 1 骨架：只确认脚本已加载；extractor 在下一分支接入。
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    console.debug('[axt] content script loaded', location.href)
  },
})
