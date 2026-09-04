// 调度（DESIGN §10）：视口优先 + 进度事件合并。
// 滚动锚定不再需要：Chrome 的原生 scroll anchoring（overflow-anchor: auto）本来就会在视口上方
// 插入内容时补偿滚动（实测插入 600px，锚点位移 0）；移植来的 JS 锚定每批强制两次全页布局，
// side 模式下每次 130–150ms，是翻译期间主线程被占满的主因。
export { VIEWPORT_OBSERVER_OPTIONS, createViewportTracker, type ViewportTracker } from './viewport'
export { createCoalescer, type Coalescer, type CoalesceOptions } from './coalesce'
