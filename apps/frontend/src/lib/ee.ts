import type { EeAuthProvider, EeFrontendHooks } from './ee-types';

/**
 * Eagerly probe for the EE submodule. When the `ee/` submodule is not
 * initialised, `import.meta.glob` returns an empty object and the OSS build
 * proceeds without any EE code bundled.
 */
const eeModules = import.meta.glob<{ default: EeFrontendHooks }>('../../../../ee/frontend/index.ts', {
	eager: true,
});

const eeHooks: EeFrontendHooks | null = Object.values(eeModules)[0]?.default ?? null;

function useNoAuthProviders(): EeAuthProvider[] {
	return [];
}

/**
 * Resolved at module load time. The choice between the EE hook and the no-op
 * is stable across renders, so calling `useEeAuthProviders` below respects the
 * Rules of Hooks.
 */
const useAuthProvidersImpl = eeHooks?.useAuthProviders ?? useNoAuthProviders;

export function useEeAuthProviders(): EeAuthProvider[] {
	return useAuthProvidersImpl();
}

export type { EeAuthProvider, EeFrontendHooks } from './ee-types';
