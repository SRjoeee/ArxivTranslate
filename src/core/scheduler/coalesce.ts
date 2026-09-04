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

export interface Coalescer {
  schedule(): void
  cancel(): void
}

export function createCoalescer(run: () => void, { delay, maxWait }: CoalesceOptions): Coalescer {
  let timer = 0
  let firstPending = 0

  const fire = () => {
    timer = 0
    firstPending = 0
    run()
  }

  return {
    schedule() {
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
    },
  }
}
