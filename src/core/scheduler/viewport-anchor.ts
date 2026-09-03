// 移植自 reference/FluentRead/src/features/full-page-translation/content/viewportStability.ts@536a819（GPL-3.0），有修改：
// 只保留 withFullPageViewportAnchor 及其 helper（导出别名 withViewportAnchor），去掉本项目用不到的滚动控制器；类型按本项目严格检查微调。

// 锚元素不能落在译文节点上，否则插入译文时锚点自身会动
const TRANSLATION_ARTIFACT_SELECTOR = '.axt-t, [data-axt-for]';

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === 'function');
}

function asHTMLElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== 'object' || (node as Node).nodeType !== 1) return null;
    const element = node as HTMLElement;
    return typeof element.tagName === 'string' && typeof element.style === 'object' ? element : null;
}

interface FullPageViewportAnchor {
    element: HTMLElement;
    top: number;
    scrollContainer: HTMLElement | null;
}

function isExcluded(element: HTMLElement, excludedNodes: readonly Node[]): boolean {
    return excludedNodes.some((excluded) => excluded === element ||
        (isElementNode(excluded) && (excluded.contains(element) || element.contains(excluded))));
}

function findScrollableAncestor(element: HTMLElement): HTMLElement | null {
    let current = element.parentElement;
    while (current && current !== document.body) {
        try {
            const style = document.defaultView?.getComputedStyle(current);
            if (style && /(auto|scroll|overlay)/u.test(style.overflowY) &&
                current.scrollHeight > current.clientHeight) return current;
        } catch {
            // Host custom elements can throw while their layout is being rebuilt.
        }
        current = current.parentElement;
    }
    return null;
}

function captureViewportAnchor(excludedNodes: readonly Node[] = []): FullPageViewportAnchor | null {
    if (typeof document === 'undefined' || typeof window === 'undefined' ||
        typeof document.elementFromPoint !== 'function') return null;

    for (const ratio of [0.5, 0.33, 0.66]) {
        const x = Math.max(0, Math.floor((window.innerWidth || 0) / 2));
        const y = Math.max(0, Math.min((window.innerHeight || 1) - 1,
            Math.floor((window.innerHeight || 1) * ratio)));
        let element = asHTMLElement(document.elementFromPoint(x, y));
        while (element && isExcluded(element, excludedNodes)) element = element.parentElement;
        if (!element || element.matches(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        try {
            const rect = element.getBoundingClientRect();
            if (!(rect.width || rect.height)) continue;
            return {element, top: rect.top, scrollContainer: findScrollableAncestor(element)};
        } catch {
            // The page may detach the candidate between hit testing and layout.
        }
    }
    return null;
}

function restoreViewportAnchor(anchor: FullPageViewportAnchor | null): void {
    if (!anchor?.element.isConnected) return;
    try {
        const offset = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(offset) <= 0.5) return;
        if (anchor.scrollContainer?.isConnected) anchor.scrollContainer.scrollTop += offset;
        else if (typeof window.scrollBy === 'function') window.scrollBy(0, offset);
    } catch {
        // Scroll anchoring is a best-effort visual safeguard and must not break translation.
    }
}

export function withFullPageViewportAnchor<T>(callback: () => T, excludedNodes: readonly Node[] = []): T {
    const anchor = captureViewportAnchor(excludedNodes);
    try {
        return callback();
    } finally {
        restoreViewportAnchor(anchor);
    }
}

/** 本项目使用的名字 */
export const withViewportAnchor = withFullPageViewportAnchor;
