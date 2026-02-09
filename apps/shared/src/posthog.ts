export interface PosthogConfig {
	key: string;
	host: string;
}

/** Get PostHog configuration from environment variables or use default values. */
export const getPosthogConfig = (env: Record<string, unknown>): PosthogConfig => ({
	key: (env.POSTHOG_KEY as string) ?? 'phc_TUN2TvdA5qjeDFU1XFVCmD3hoVk1dmWree4cWb0dNk4',
	host: (env.POSTHOG_HOST as string) || 'https://eu.i.posthog.com',
});
