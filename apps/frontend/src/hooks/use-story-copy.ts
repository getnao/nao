import { marked } from 'marked';
import { useCallback, useState } from 'react';

import { trpcClient } from '@/main';

export interface StoryCopyOptions {
	storyId?: string;
	chatId?: string;
	storySlug?: string;
	shareId?: string;
	shareType?: 'chat' | 'story';
	isOwner?: boolean;
	versionNumber?: number;
}

export function useStoryCopy({
	storyId,
	chatId,
	storySlug,
	shareId,
	shareType = 'story',
	isOwner = true,
	versionNumber,
}: StoryCopyOptions) {
	const [isCopying, setIsCopying] = useState(false);
	const canCopy = isOwner || !!shareId || !!storyId;
	const [error, setError] = useState<string | null>(null);

	const copyStory = useCallback(async () => {
		if (!canCopy || isCopying) {
			return;
		}
		setIsCopying(true);
		setError(null);
		try {
			let result;
			if (storyId) {
				result = await trpcClient.story.downloadStandalone.query({
					storyId,
					format: 'markdown',
					clipboardChartUrls: true,
				});
			} else if (isOwner) {
				result = await trpcClient.story.download.query({
					chatId: chatId!,
					storySlug: storySlug!,
					format: 'markdown',
					versionNumber,
					clipboardChartUrls: true,
				});
			} else if (shareType === 'chat') {
				result = await trpcClient.sharedChat.downloadStory.query({
					shareId: shareId!,
					storySlug: storySlug!,
					format: 'markdown',
					versionNumber,
					clipboardChartUrls: true,
				});
			} else {
				result = await trpcClient.storyShare.download.query({
					shareId: shareId!,
					format: 'markdown',
					versionNumber,
					clipboardChartUrls: true,
				});
			}
			const markdown = new TextDecoder().decode(
				Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0)),
			);
			await writeMarkdownToClipboard(markdown);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Copy failed';
			setError(message);
			console.error('Story copy failed:', err);
		} finally {
			setIsCopying(false);
		}
	}, [canCopy, isCopying, isOwner, storyId, chatId, storySlug, shareId, shareType, versionNumber]);

	return { copyStory, isCopying, canCopy, error };
}

async function writeMarkdownToClipboard(markdown: string): Promise<void> {
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		throw new Error('Clipboard access is unavailable in this browser.');
	}

	if (!clipboard.write || typeof ClipboardItem === 'undefined') {
		await clipboard.writeText(markdown);
		return;
	}

	const html = sanitizeClipboardHtml(marked.parse(markdown, { async: false, gfm: true }));
	const clipboardItem = new ClipboardItem({
		'text/plain': new Blob([markdown], { type: 'text/plain' }),
		'text/html': new Blob([html], { type: 'text/html' }),
	});

	await clipboard.write([clipboardItem]);
}

function sanitizeClipboardHtml(html: string): string {
	const document = new DOMParser().parseFromString(html, 'text/html');
	document.querySelectorAll('script, style, iframe, object, embed, svg, math').forEach((element) => element.remove());

	for (const element of document.body.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			if (
				name.startsWith('on') ||
				name === 'style' ||
				name === 'srcdoc' ||
				(URL_ATTRIBUTES.has(name) && !isSafeClipboardUrl(element, name, attribute.value))
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}

	return document.body.innerHTML;
}

const URL_ATTRIBUTES = new Set([
	'action',
	'background',
	'cite',
	'formaction',
	'href',
	'longdesc',
	'ping',
	'poster',
	'src',
	'srcset',
	'usemap',
	'xlink:href',
]);

function isSafeClipboardUrl(element: Element, attributeName: string, value: string): boolean {
	if (attributeName === 'src' && element.tagName === 'IMG' && isPngDataUrl(value)) {
		return true;
	}
	if (
		(attributeName !== 'href' || element.tagName !== 'A') &&
		(attributeName !== 'src' || element.tagName !== 'IMG')
	) {
		return false;
	}

	try {
		const protocol = new URL(value, window.location.origin).protocol;
		return protocol === 'http:' || protocol === 'https:' || (element.tagName === 'A' && protocol === 'mailto:');
	} catch {
		return false;
	}
}

function isPngDataUrl(value: string): boolean {
	return /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(value.trim());
}
