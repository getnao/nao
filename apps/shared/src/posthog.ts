export interface PosthogConfig {
	key: string;
	host: string;
}

export const getPosthogConfig = (): PosthogConfig => ({
	key: 'phc_TUN2TvdA5qjeDFU1XFVCmD3hoVk1dmWree4cWb0dNk4',
	host: 'https://eu.i.posthog.com',
});
