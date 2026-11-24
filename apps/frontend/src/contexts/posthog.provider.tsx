import posthogClient from 'posthog-js';
import { PostHogProvider as PostHogProviderOriginal, usePostHog as usePostHogOriginal } from 'posthog-js/react';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import type { PostHog, PostHogConfig } from 'posthog-js';
import type { ReactNode } from 'react';
import { trpc } from '@/main';

const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
	defaults: '2025-05-24',
	debug: import.meta.env.MODE === 'development',
	autocapture: false,
	capture_pageview: true,
	capture_heatmaps: false,
	capture_performance: false,
	capture_dead_clicks: false,
	capture_exceptions: false,
	disable_scroll_properties: true,
	disable_session_recording: true,
};

/**
 * Context to track whether PostHog is configured.
 * This allows usePostHog to safely return `undefined` when outside PostHogProvider.
 */
const PostHogEnabledContext = createContext<boolean>(false);

/**
 * Provides a PostHog client if configured via environment variables.
 * The provider tree keeps the same shape once the config loads so the app below it is not remounted.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
	const { data: posthogConfig, isLoading } = useQuery(trpc.posthog.getConfig.queryOptions());
	const [isEnabled, setIsEnabled] = useState(false);

	useEffect(() => {
		if (isLoading) {
			return;
		}
		if (!posthogConfig?.isEnabled) {
			console.log('[Tracking] - Disabled');
			return;
		}
		if (!posthogClient.__loaded) {
			posthogClient.init(posthogConfig.key, { ...POSTHOG_OPTIONS, api_host: posthogConfig.host });
		}
		setIsEnabled(true);
	}, [posthogConfig, isLoading]);

	return (
		<PostHogEnabledContext.Provider value={isEnabled}>
			<PostHogProviderOriginal client={posthogClient}>{children}</PostHogProviderOriginal>
		</PostHogEnabledContext.Provider>
	);
}

/**
 * Safe hook to get the PostHog client.
 * Use this instead of importing usePostHog from 'posthog-js/react' directly.
 */
export function usePostHog(): PostHog | undefined {
	const isEnabled = useContext(PostHogEnabledContext);
	const posthog = usePostHogOriginal();

	if (!isEnabled) {
		return undefined;
	}

	return posthog;
}
