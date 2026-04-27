import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EeBackendHooks } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the EE backend entry point. When the `ee/` submodule is not
 * initialised (open-source clone), this file does not exist and we fall back
 * to OSS behaviour.
 */
const EE_BACKEND_ENTRY = path.resolve(__dirname, '../../../../ee/backend/index.ts');

let cached: EeBackendHooks | null | undefined;

export async function getEeHooks(): Promise<EeBackendHooks | null> {
	if (cached !== undefined) {
		return cached;
	}

	if (!existsSync(EE_BACKEND_ENTRY)) {
		cached = null;
		return cached;
	}

	try {
		const mod = (await import(EE_BACKEND_ENTRY)) as { default?: EeBackendHooks };
		cached = mod.default ?? null;
	} catch (err) {
		console.warn('[ee] Failed to load EE backend hooks:', err);
		cached = null;
	}

	return cached;
}

export type { EeBackendHooks, SocialProviders } from './types';
