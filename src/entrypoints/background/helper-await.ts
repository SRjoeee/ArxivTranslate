// 安装引导的等待（DESIGN §15.4，issue #102）。
//
// 读者把安装命令粘进终端之后，没有任何事件会告诉扩展「装好了」：安装脚本写的是磁盘上的
// native host 清单，而 Chrome 只在 `connectNative` 那一刻才去读它。所以这里定时探。
//
// **为什么不让读者点一个「我已经装好了」**：那一步把程序自己答得出的问题推给了读者，
// 而且读者按下它的时候多半人还在终端里——popup 一失焦就销毁，他得先想起来回到扩展。
//
// MV3 的两个约束决定了形状：
// - `setTimeout` **不能**阻止 service worker 被回收，只有消息与扩展 API 调用会重置闲置计时。
//   这里每轮都要调 `connectNative`（探测本身就是 API 调用），2 秒一轮远小于 30 秒的闲置线，
//   所以不需要额外的保活动作——helper.ts 那套在飞保活是给「一个请求几十秒没回来」准备的，
//   与这里的形状不同。
// - worker 仍可能因别的原因被回收（浏览器回收内存、扩展重载）。截止时间因此写进 session
//   storage，worker 下次醒来把没到期的等待接上；storage 是 session 而不是 local：
//   浏览器关掉之后这次安装就不必再等了。
import type { HelperStatus } from '@/shared/ocr'

/** 探测间隔。安装脚本本身要跑几十秒，这个粒度只决定「装完到页面开始翻」之间的延迟 */
const DEFAULT_POLL_MS = 2_000
/**
 * 最长等多久。超过之后读者多半没在装了（命令没跑、报错了、改主意了），
 * 再探下去只是白占 worker——界面上那句「尚未检测到」也是在这个点之后才出现的
 */
const DEFAULT_WINDOW_MS = 180_000

export interface HelperWaitDeps {
  /** 重新探测一次（`recheck` 会清掉「未安装」的记录，见 HelperClient.status） */
  probe: () => Promise<HelperStatus>
  /** 探到了：把消息发给每个标签页，让停着的位图放出去 */
  announce: () => void | Promise<void>
  now: () => number
  schedule: (run: () => void, ms: number) => number
  cancel: (id: number) => void
  /** 截止时间的读写；worker 被回收后靠它接上 */
  load: () => Promise<number | undefined>
  save: (deadline: number | undefined) => Promise<void>
  pollMs?: number
  windowMs?: number
  /** 探测抛异常时记一笔；不打断等待 */
  warn?: (message: string, error: unknown) => void
}

export interface HelperWaiter {
  /**
   * 开始等待。**幂等**：已经在等的话只把截止时间推回满窗——读者复制第二次通常意味着
   * 第一次没粘上，这时该给他完整的一窗，而不是沿用快到期的那个
   */
  start: () => Promise<void>
  /** worker 刚起来：storage 里还有没到期的等待就接上 */
  resume: () => Promise<void>
  /**
   * 这一次等待的截止时间；没等过为 null。**可能已经过去**——那说明等过、没等到，
   * 界面据此在重开之后说「尚未检测到」。探到或重新开始才清掉
   */
  until: () => number | null
  /** 停下并清掉存着的截止时间 */
  stop: () => Promise<void>
}

export function createHelperWaiter(deps: HelperWaitDeps): HelperWaiter {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS
  let deadline: number | null = null
  let timer: number | null = null
  /** 一轮探测还没回来时不开第二轮：`connectNative` 的失败很快，但不保证比 pollMs 快 */
  let probing = false

  const disarm = () => {
    if (timer !== null) deps.cancel(timer)
    timer = null
  }

  /** 彻底结束：探到了，或者外部撤掉 */
  const clear = async (): Promise<void> => {
    disarm()
    deadline = null
    await deps.save(undefined)
  }

  const arm = () => {
    if (timer !== null) return
    timer = deps.schedule(() => {
      timer = null
      void tick()
    }, pollMs)
  }

  const tick = async (): Promise<void> => {
    if (deadline === null) return
    if (deps.now() >= deadline) {
      // 到点了停掉轮次，但**留着这个过期的截止时间**：读者多半这时还在终端里，
      // 等他回来重开 popup，界面要能分辨「等过、没等到」与「压根没开始」——
      // 清掉的话两者都是 null，那句「尚未检测到」就永远不会出现（Codex 在 #166 指出）
      disarm()
      return
    }
    // **先排下一轮，再探**：排在探测之后的话，一次挂住的探测会让等待静默停住——
    // 没有定时器了，到点也没人去检查。现在轮次的节奏与探测的快慢互不相干
    arm()
    if (probing) return
    probing = true
    try {
      const status = await deps.probe()
      if (status.available) {
        await clear()
        await deps.announce()
      }
    } catch (error) {
      // 探测本身失败（端口刚断、worker 正在关）不该结束等待：下一轮再来
      deps.warn?.('[axt] 识别助手探测失败', error)
    } finally {
      probing = false
    }
  }

  return {
    async start() {
      deadline = deps.now() + windowMs
      await deps.save(deadline)
      arm()
    },
    async resume() {
      if (deadline !== null) return
      const saved = await deps.load()
      // **读完再判一次**：守卫写在 await 之前，而读 storage 期间读者可能已经点了复制。
      // 那一次是更新的、明确的动作，不许被读回来的旧值（甚至过期值）盖掉——盖掉的话
      // 新的一次安装一开始就显示成超时（Codex 在 #166 指出）
      if (deadline !== null || saved === undefined) return
      // 过期的也认下来、但不再探：界面要靠它说出「尚未检测到」。
      // session storage 随浏览器关闭而空，留着不占长期的地方
      deadline = saved
      if (saved > deps.now()) arm()
    },
    until: () => deadline,
    stop: clear,
  }
}
