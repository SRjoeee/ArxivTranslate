import { defineConfig } from 'wxt'

// WXT 工程配置。host_permissions 等到 Phase 3 接网络引擎时再加。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'arXiv HTML Translator',
    description: '面向 arxiv.org/html 的保结构、可逆双语翻译',
    permissions: ['storage'],
    // background 向 LLM 端点 fetch 需要 host 权限；默认只给 OpenRouter，自定义 baseURL 在设置页保存时按 origin 申请
    host_permissions: ['https://openrouter.ai/*'],
    optional_host_permissions: ['https://*/*', 'http://localhost/*'],
  },
})
