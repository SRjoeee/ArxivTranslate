// A hook mounted in a real React root over happy-dom, for the data layers of the popup and the settings page: they
// are hooks, and what they promise — which ask publishes, when a reload waits — is only visible through one
import { type ReactElement, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

export const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export interface MountedHook<T> {
  /** The hook's latest return value */
  current(): T
  /** Let pending promises settle and React commit */
  flush(): Promise<void>
  /**
   * Flush until `ready()` holds, up to `ticks` rounds: a mount-time read (storage, a digest) takes as many ticks as the
   * machine gives it — one was enough locally and not on CI
   */
  until(ready: () => boolean, ticks?: number): Promise<void>
  /** Run an action inside `act` and settle after it */
  run(action: () => void | Promise<void>): Promise<void>
  unmount(): Promise<void>
}

export async function mountHook<T>(use: () => T): Promise<MountedHook<T>> {
  let latest: T | undefined
  function Probe() {
    latest = use()
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const flush = async () => { await act(async () => { await tick() }) }
  await act(async () => { root.render(createElement(Probe)) })
  await flush()
  const until = async (ready: () => boolean, ticks = 50) => {
    for (let i = 0; i < ticks && !ready(); i++) await flush()
    if (!ready()) throw new Error(`the hook did not reach the expected state within ${ticks} ticks`)
  }
  return {
    current: () => latest as T,
    flush,
    until,
    run: async action => { await act(async () => { await action() }); await flush() },
    unmount: async () => { await act(async () => { root.unmount() }); container.remove() },
  }
}

export interface MountedElement {
  container: HTMLElement
  /** Render another element into the same root and settle */
  rerender(element: ReactElement): Promise<void>
  flush(): Promise<void>
  unmount(): Promise<void>
}

/** A component mounted in a real React root over happy-dom, for what a section shows */
export async function mountElement(element: ReactElement): Promise<MountedElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const flush = async () => { await act(async () => { await tick() }) }
  await act(async () => { root.render(element) })
  await flush()
  return {
    container,
    rerender: async next => { await act(async () => { root.render(next) }); await flush() },
    flush,
    unmount: async () => { await act(async () => { root.unmount() }); container.remove() },
  }
}
