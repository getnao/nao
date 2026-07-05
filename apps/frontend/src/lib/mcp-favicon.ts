const FAVICON_PATHS = ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png'];

export const getFaviconCandidates = (url?: string): string[] => {
	if (!url) {
		return [];
	}
	try {
		const origin = new URL(url).origin;
		return FAVICON_PATHS.map((path) => `${origin}${path}`);
	} catch {
		return [];
	}
};
