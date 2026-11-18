import { useEffect, useMemo } from 'react';
import superjson from 'superjson';

const STORAGE_PREFIX = 'last-seen:';

interface LastSeenEntry {
	scope: string;
	value: unknown;
}

/**
 * Remembers a loaded value in this browser and returns it while the value loads again on the next visit,
 * so slow lists show up at once instead of popping in. `scope` must name everything the value depends on.
 */
export function useLastSeen<Value>(name: string, scope: string, value: Value | undefined): Value | undefined {
	const lastSeen = useMemo(() => readLastSeen<Value>(name, scope), [name, scope]);

	useEffect(() => {
		if (value !== undefined) {
			writeLastSeen(name, { scope, value });
		}
	}, [name, scope, value]);

	return value ?? lastSeen;
}

export function clearLastSeen() {
	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(STORAGE_PREFIX)) {
				localStorage.removeItem(key);
			}
		}
	} catch {
		return;
	}
}

function readLastSeen<Value>(name: string, scope: string): Value | undefined {
	try {
		const stored = localStorage.getItem(STORAGE_PREFIX + name);
		const entry = stored ? superjson.parse<LastSeenEntry>(stored) : null;
		return entry?.scope === scope ? (entry.value as Value) : undefined;
	} catch {
		return undefined;
	}
}

function writeLastSeen(name: string, entry: LastSeenEntry) {
	try {
		localStorage.setItem(STORAGE_PREFIX + name, superjson.stringify(entry));
	} catch {
		removeLastSeen(name);
	}
}

function removeLastSeen(name: string) {
	try {
		localStorage.removeItem(STORAGE_PREFIX + name);
	} catch {
		return;
	}
}
