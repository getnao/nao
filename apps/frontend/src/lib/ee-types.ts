import type { ComponentType } from 'react';

export interface EeAuthProvider {
	id: string;
	label: string;
	Icon: ComponentType<{ className?: string }>;
	signIn: () => Promise<void> | void;
}

export interface EeFrontendHooks {
	/**
	 * React hook returning the list of enabled EE sign-in providers.
	 * Implementations can inspect tRPC setup queries internally.
	 */
	useAuthProviders: () => EeAuthProvider[];
}
