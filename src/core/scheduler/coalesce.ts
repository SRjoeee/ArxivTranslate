// 合并连续事件（DESIGN §10）：去抖之外加一个"最长等待"。
//
// 纯去抖会被连续事件饿死：翻译进行中每秒来几十次进度回调，150ms 的计时器一直被重置，
// side 模式的镜像 / 拆图 / 表格缩放直到整篇翻完才跑一次——实测 2312.17141：
// 413 个镜像全部在最后一刻同时出现，之前公式一直居中横跨两栏（用户反馈）。
// 加上最长等待后，事件再密也至少每 maxWait 跑一次。

export interface CoalesceOptions {
  /** 最后一次事件之后再等多久 */
  delay: number
  /** 从第一次未处理的事件算起最多等多久 */
  maxWait: number
}

export interface Coalescer<T = never> {
  /**
   * 排一次整理。带参数 = 把这个项攒进本轮的脏集合；不带参数 = 本轮**全量**。
   * 同一轮里出现过一次不带参数的调用，跑的时候就拿到 null，脏集合作废
   */
  schedule(item?: T): void
  cancel(): void
}

/**
 * `run` 收到的是这一轮攒下的项（去重、按加入顺序），或 null 表示全量（issue #46）。
 * 攒项而不只是攒"要不要跑"：合并器把几十次进度回调压成一趟，整理步骤得知道这一趟该碰哪些块，
 * 否则每趟都只能全篇重扫——实测 2312.17141 一次会话 31 趟、累计 1.9 秒，单趟只要 34 ms
 */
export function createCoalescer<T = never>(run: (scope: T[] | null) => void, { delay, maxWait }: CoalesceOptions): Coalescer<T> {
  let timer = 0
  let firstPending = 0
  let items = new Set<T>()
  let full = false

  const fire = () => {
    timer = 0
    firstPending = 0
    const scope = full ? null : Array.from(items)
    items = new Set()
    full = false
    run(scope)
  }

  return {
    schedule(item?: T) {
      if (item === undefined) full = true
      else items.add(item)
      const now = Date.now()
      if (!firstPending) firstPending = now
      clearTimeout(timer)
      // 不能再往后推了就按最长等待到期的时刻跑
      const wait = Math.max(0, Math.min(delay, firstPending + maxWait - now))
      timer = window.setTimeout(fire, wait)
    },
    cancel() {
      clearTimeout(timer)
      timer = 0
      firstPending = 0
      items = new Set()
      full = false
    },
  }
}
