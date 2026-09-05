// 移植自 reference/read-frog/src/utils/host/translate/translation-session.ts@9b44f82（GPL-3.0），2026-09-05 移植、有修改：
// 去掉 providerRef 的两个函数（那是它的 hosted 状态，我们的 provider 在 start() 里一次取好）。
//
// 当前页面翻译会话的身份。模块级变量是对的：一个 frame 只有一个会话。
// 每个请求都带这个 id 作 scope，用户取消时 translate-service 按它撤掉排队与在飞的请求（它的 #1881）；
// 每次会话一个新 id，撤销旧的一波绝不会影响重开后的请求。
// id 只是关联键不是密码学材料——故意不用 getRandomUUID，与 walk id 不共用来源；随机段保证同一标签页多个 frame 互不相同。

let currentSessionId: string | null = null
let sessionCounter = 0

export function beginSession(): string {
  sessionCounter += 1
  currentSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${sessionCounter}`
  return currentSessionId
}

export function endSession(): string | null {
  const ended = currentSessionId
  currentSessionId = null
  return ended
}

export function getSessionId(): string | null {
  return currentSessionId
}
