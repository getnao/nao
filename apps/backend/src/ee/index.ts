/* @license Enterprise */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EeBackendHooks } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate `ee/backend/index.ts` by walking up from this module. This tolerates
 * both the source layout (`apps/backend/src/ee/`) and any compiled layout
 * (e.g. `apps/backend/dist/`), so EE hooks load regardless of how the backend
 * is launched. Returns null when the `ee/` submodule is not initialised
 * (open-source clone), so callers fall back to OSS behaviour.
 */
function findEeBackendEntry(): string | null {
	let current = __dirname;
	const { root } = path.parse(current);

	while (current !== root) {
		const candidate = path.join(current, 'ee', 'backend', 'index.ts');
		if (existsSync(candidate)) {
			return candidate;
		}
		current = path.dirname(current);
	}

	return null;
}

let cached: EeBackendHooks | null | undefined;

export async function getEeHooks(): Promise<EeBackendHooks | null> {
	if (cached !== undefined) {
		return cached;
	}

	const eeEntry = findEeBackendEntry();
	if (!eeEntry) {
		cached = null;
		return cached;
	}

	try {
		const mod = (await import(eeEntry)) as { default?: EeBackendHooks };
		cached = mod.default ?? null;
	} catch (err) {
		console.warn('[ee] Failed to load EE backend hooks:', err);
		cached = null;
	}

	return cached;
}

export type { EeBackendHooks, SocialProviders } from './types';
