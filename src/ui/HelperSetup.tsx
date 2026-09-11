// 识别助手的安装引导（UI.md S-O-27，DESIGN §15.4）。popup 与设置页**共用这一个组件**：
// 两处要说的是同一件事，分两套写法只会漂移。
//
// 流程两步：打开终端、执行命令。**没有第三步**——原来那个「我已经装好了」按钮把程序自己
// 答得出的问题推给了读者，而他按下它的时候多半还在终端里。复制之后由 background 定时探，
// 探到就广播，页面上停着的图自己开始翻（§15.4）。
//
// 等待状态存在 background 而不是这里：popup 一失焦就销毁，读者切到终端的那一刻这个组件
// 就没了；重新打开时靠 `axt:helper-await` 问一句把同一次等待接上。
import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { HELPER_GUIDE_URL, S, helperInstallCommand } from '@/ui/strings'

/** 已复制停留多久：够读，又不至于看着像卡住 */
const COPIED_MS = 1500

export function HelperSetup({ extensionId, onStatus }: { extensionId: string; onStatus?: (status: HelperStatus) => void }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  /** 等到什么时候；null 表示没在等。来源是 background，不是本组件的 state */
  const [until, setUntil] = useState<number | null>(null)
  /** 这一窗等完了也没探到 */
  const [timedOut, setTimedOut] = useState(false)
  const command = helperInstallCommand(extensionId)

  // 挂载时问一句：读者可能是复制完切去终端、再回来重开的（popup 失焦即销毁）
  useEffect(() => {
    let alive = true
    void sendMessage({ type: 'axt:helper-await' })
      .then(({ until: deadline }) => { if (alive) setUntil(deadline) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  // 这一窗走完就把话说出来。用 background 给的截止时间而不是本地计时：
  // 重开之后剩多久是它说了算
  useEffect(() => {
    if (until === null) return
    setTimedOut(false)
    const left = until - Date.now()
    if (left <= 0) { setTimedOut(true); return }
    const timer = setTimeout(() => setTimedOut(true), left)
    return () => clearTimeout(timer)
  }, [until])

  // background 探到了会广播一条：设置页开着就当场换成「已就绪」，
  // popup 还开着的话同理（没有页面在听时这条消息根本没人收，那也正常）
  useEffect(() => {
    const onReady = (message: unknown) => {
      if ((message as { type?: string } | null)?.type !== 'axt:helper-ready') return
      setUntil(null)
      void sendMessage({ type: 'axt:helper-status' }).then(onStatus).catch(() => undefined)
    }
    browser.runtime.onMessage.addListener(onReady)
    return () => browser.runtime.onMessage.removeListener(onReady)
  }, [onStatus])

  /**
   * 只在写入成功之后才说「已复制」。剪贴板被挡住时若照说不误，读者手上其实什么都没有，
   * 而这是整个安装唯一悬着的一步（Codex 在 #161 指出）
   */
  const copy = async () => {
    // 复制即开始等：读者接下来就要切到终端，那一刻这个组件已经不在了。
    // **剪贴板被挡住时同样要开始**——那条路上的提示是「请手动选中命令后复制」，读者照做、装成了，
    // 却没人在探，页面上停着的图就一直停着，而确认按钮已经没有了（Codex 在 #166 指出）
    const beginWaiting = () => void sendMessage({ type: 'axt:helper-await', start: true })
      .then(({ until: deadline }) => setUntil(deadline))
      .catch(() => undefined)
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      setCopyFailed(true)
      beginWaiting()
      return
    }
    setCopyFailed(false)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
    beginWaiting()
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-[13px] font-semibold text-fg">{S.setup.title}</p>
      <p className="text-[12px] leading-relaxed text-fg-2">{S.setup.intro}</p>

      <Step n={1} title={S.setup.step1} hint={S.setup.step1Hint} />

      <Step n={2} title={S.setup.step2} hint={copyFailed ? S.setup.copyFailed : copied ? S.helper.copied : S.setup.step2Hint}>
        {/* 命令整块是一个按钮：读者第一下要点的就是它。**折行而不是横向滚动**——
            这是一条 `curl | bash`，看不到结尾便无从判断是否应当执行。`select-all` 让
            ⌘A 落在命令上而不是整页 */}
        <button
          type="button"
          onClick={() => void copy()}
          title={S.helper.copy}
          className="flex w-full cursor-pointer items-start gap-2 rounded-control bg-bg px-3 py-2.5 text-left font-mono text-[11px] leading-relaxed text-fg ring-1 ring-line"
        >
          <span aria-hidden="true" className="shrink-0 text-fg-2">$</span>
          <code className="min-w-0 flex-1 select-all break-all whitespace-pre-wrap">{command}</code>
        </button>
      </Step>

      {/* 这一行是整个流程的关键：它取代了「我已经装好了」按钮，读者据此知道可以走开了。
          等待中与超时是同一处的两种说法，不切换界面——读者不必在两处之间比对进度。
          **还没复制时什么都不说**：那时步骤二的提示已经写着「点击复制」，再说一遍是废话 */}
      {(until !== null || timedOut) && (
        <p role="status" className={`text-[11px] leading-relaxed ${timedOut ? 'text-accent' : 'text-fg-2'}`}>
          {timedOut ? S.setup.notYet : S.setup.waiting}
        </p>
      )}

      <a className="self-start text-[12px] font-semibold text-fg-2 hover:text-fg" href={HELPER_GUIDE_URL} target="_blank" rel="noreferrer">{S.helper.guide}</a>
    </div>
  )
}

/** 一个带序号的步骤：序号自成一列，标题与它下面的控件才对得齐 */
function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span aria-hidden="true" className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-control text-[11px] font-semibold text-fg-2">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        <span className="text-[11px] leading-relaxed text-fg-2">{hint}</span>
        {children}
      </span>
    </div>
  )
}
