const LAST_RELOAD_STORAGE_KEY = 'nao:stale-chunk-reload-at';
const MIN_RELOAD_INTERVAL_MS = 10_000;

/**
 * A deploy replaces the hashed chunks, so a tab opened before it fails to lazy-load them.
 * Reloading fetches the new index.html and its chunks; the interval guard avoids a reload loop
 * when the chunk is unreachable for another reason, so without storage to hold it we never reload.
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
	return writeStorage(LAST_RELOAD_STORAGE_KEY, String(now));
}

function readStorage(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): boolean {
	try {
		sessionStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}
