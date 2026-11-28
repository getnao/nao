import { vi } from 'vitest';

/**
 * Radix popovers and menus measure their content with ResizeObserver, which jsdom does not implement.
 * Returns a function that notifies every observing callback, to stand in for a resize.
 */
export function stubResizeObserver() {
	const observingCallbacks = new Set<ResizeObserverCallback>();
	vi.stubGlobal(
		'ResizeObserver',
		class {
			private readonly callback: ResizeObserverCallback;

			constructor(callback: ResizeObserverCallback) {
				this.callback = callback;
			}

			observe() {
				observingCallbacks.add(this.callback);
			}

			unobserve() {}

			disconnect() {
				observingCallbacks.delete(this.callback);
			}
		},
	);
	return () => {
		observingCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
	};
}

/** jsdom does not implement scrollIntoView; it stays writable so later test files on the same worker can replace it. */
export function stubScrollIntoView(scrollIntoView = vi.fn()) {
	Object.defineProperty(Element.prototype, 'scrollIntoView', {
		configurable: true,
		writable: true,
		value: scrollIntoView,
	});
	return scrollIntoView;
}

export function stubLocalStorage() {
	vi.stubGlobal('localStorage', createMemoryStorage());
}

export function stubClipboard(writeText: (text: string) => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
}

function createMemoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value),
	};
}
