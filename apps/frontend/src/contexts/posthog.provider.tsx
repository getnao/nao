import { PostHogProvider as PostHogProviderOriginal, usePostHog as usePostHogOriginal } from 'posthog-js/react';
import { createContext, useContext } from 'react';
import type { PostHog } from 'posthog-js';
import type { ReactNode } from 'react';

const POSTHOG_DISABLED = import.meta.env.POSTHOG_DISABLED === 'true';
const POSTHOG_KEY = import.meta.env.POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.POSTHOG_HOST;

// PostHog is enabled only if not disabled AND both key and host are configured
const POSTHOG_ENABLED = !POSTHOG_DISABLED && !!POSTHOG_KEY && !!POSTHOG_HOST;

/**
 * Context to track whether PostHog is configured.
 * This allows usePostHog to safely return `undefined` when outside PostHogProvider.
 */
const PostHogEnabledContext = createContext<boolean>(false);

/**
 * Provides a PostHog client if configured via environment variables.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
	if (!POSTHOG_ENABLED) {
		return <PostHogEnabledContext.Provider value={false}>{children}</PostHogEnabledContext.Provider>;
	}

	return (
		<PostHogEnabledContext.Provider value={true}>
			<PostHogProviderOriginal
				apiKey={POSTHOG_KEY}
				options={{
					api_host: POSTHOG_HOST,
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
