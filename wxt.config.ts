import { defineConfig } from 'wxt'

// WXT 工程配置。host_permissions 等到 Phase 3 接网络引擎时再加。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'arXiv HTML Translator',
    description: '面向 arxiv.org/html 的保结构、可逆双语翻译',
    permissions: ['storage'],
  },
})
