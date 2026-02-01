import { useQuery } from '@tanstack/react-query';
import { PostHogProvider as PostHogProviderOriginal, usePostHog as usePostHogOriginal } from 'posthog-js/react';
import { createContext, useContext } from 'react';
import type { PostHog } from 'posthog-js';
import type { ReactNode } from 'react';
import { trpc } from '@/main';

/**
 * Context to track whether PostHog is configured.
 * This allows usePostHog to safely return `undefined` when outside PostHogProvider.
 */
const PostHogEnabledContext = createContext<boolean>(false);

/**
 * Fetches PostHog config from the backend and provides a PostHog client if configured.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
	const { data: config, isLoading } = useQuery(trpc.config.getPostHogConfig.queryOptions());

	// Don't block rendering while loading - just skip PostHog if not ready
	if (isLoading) {
		return <PostHogEnabledContext.Provider value={false}>{children}</PostHogEnabledContext.Provider>;
	}

	// If no PostHog API key configured, render children without PostHog
	if (!config?.posthog.apiKey) {
		return <PostHogEnabledContext.Provider value={false}>{children}</PostHogEnabledContext.Provider>;
	}

	return (
		<PostHogEnabledContext.Provider value={true}>
			<PostHogProviderOriginal
				apiKey={config.posthog.apiKey}
				options={{
					api_host: config.posthog.apiHost,
					defaults: '2025-05-24',
					debug: import.meta.env.MODE === 'development',
					autocapture: false,
					capture_pageview: false,
					capture_heatmaps: false,
					capture_performance: false,
					capture_dead_clicks: false,
					capture_exceptions: false,
					disable_scroll_properties: true,
					disable_session_recording: true,
				}}
			>
				{children}
			</PostHogProviderOriginal>
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
