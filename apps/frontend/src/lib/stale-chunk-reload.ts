const LAST_RELOAD_STORAGE_KEY = 'nao:stale-chunk-reload-at';
const MIN_RELOAD_INTERVAL_MS = 10_000;

/**
 * A deploy replaces the hashed chunks, so a tab opened before it fails to lazy-load them.
 * Reloading fetches the new index.html and its chunks; the interval guard avoids a reload loop
 * when the chunk is unreachable for another reason.
 */
export function reloadOnStaleChunkError(): void {
	window.addEventListener('vite:preloadError', () => {
		if (shouldReload(Date.now())) {
			window.location.reload();
		}
	});
}

export function shouldReload(now: number): boolean {
	const lastReloadAt = Number(readStorage(LAST_RELOAD_STORAGE_KEY));
	if (lastReloadAt && now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
		return false;
	}
	writeStorage(LAST_RELOAD_STORAGE_KEY, String(now));
	return true;
}

function readStorage(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		return;
	}
}
