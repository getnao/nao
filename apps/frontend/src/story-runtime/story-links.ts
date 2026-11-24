import { isStoryLinkUrl } from '@nao/shared/story-app';

type OpenUrl = (url: string) => void;

/**
 * The sandboxed frame can neither open a tab nor leave itself, so a plain click on a web link asks the host to
 * open it. Modified clicks keep the browser's own behaviour, and a story that handles the click itself keeps it.
 */
export function routeLinkClicks(openUrl: OpenUrl): () => void {
	const handleClick = (event: MouseEvent) => {
		const url = readLinkClick(event);
		if (url) {
			event.preventDefault();
			openUrl(url);
		}
	};
	document.addEventListener('click', handleClick);
	return () => document.removeEventListener('click', handleClick);
}

function readLinkClick(event: MouseEvent): string | null {
	if (!isPlainClick(event)) {
		return null;
	}
	const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
	if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || isInPageLink(link)) {
		return null;
	}
	return isStoryLinkUrl(link.href) ? link.href : null;
}

function isPlainClick(event: MouseEvent): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

function isInPageLink(link: HTMLAnchorElement): boolean {
	return link.getAttribute('href')?.startsWith('#') ?? false;
}
