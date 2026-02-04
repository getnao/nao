import { PostHogProvider as PostHogProviderOriginal, usePostHog as usePostHogOriginal } from 'posthog-js/react';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { getPosthogConfig } from '@nao/shared/posthog';
import type { PostHog } from 'posthog-js';
import type { ReactNode } from 'react';
import { trpc } from '@/main';

/**
 * Context to track whether PostHog is configured.
 * This allows usePostHog to safely return `undefined` when outside PostHogProvider.
 */
const PostHogEnabledContext = createContext<boolean>(false);

const posthogConfig = getPosthogConfig(import.meta.env);

/**
 * Provides a PostHog client if configured via environment variables.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
	const { data: isEnabled, isLoading } = useQuery(trpc.posthog.isEnabled.queryOptions());

	if (!isEnabled || isLoading) {
		return <PostHogEnabledContext.Provider value={false}>{children}</PostHogEnabledContext.Provider>;
	}

	return (
		<PostHogEnabledContext.Provider value={true}>
			<PostHogProviderOriginal
				apiKey={posthogConfig.key}
				options={{
					api_host: posthogConfig.host,
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
