/* @license Enterprise */

import { useEffect } from 'react';

import { brandingAssetUrl, useBranding } from '@/hooks/use-branding';

const DEFAULT_TITLE = 'nao — Chat with your data';
const DEFAULT_FAVICON = '/favicon.ico';

/**
 * Sync the browser tab (title + favicon) with the active white-label branding.
 * Restores defaults whenever the feature is disabled or no override is set so
 * an admin toggling the license off does not strand the page with stale chrome.
 */
export function BrandingHead() {
	const branding = useBranding();

	useEffect(() => {
		const title = branding.enabled && branding.tabTitle ? branding.tabTitle : DEFAULT_TITLE;
		document.title = title;
	}, [branding.enabled, branding.tabTitle]);

	useEffect(() => {
		const href =
			branding.enabled && branding.hasFavicon ? brandingAssetUrl('favicon', branding.updatedAt) : DEFAULT_FAVICON;
		setFaviconHref(href);
		return () => setFaviconHref(DEFAULT_FAVICON);
	}, [branding.enabled, branding.hasFavicon, branding.updatedAt]);

	return null;
}

function setFaviconHref(href: string) {
	let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
	if (!link) {
		link = document.createElement('link');
		link.rel = 'icon';
		document.head.appendChild(link);
	}
	if (link.getAttribute('href') !== href) {
		link.setAttribute('href', href);
	}
}
