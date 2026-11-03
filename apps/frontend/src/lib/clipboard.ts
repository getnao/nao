/**
 * The async Clipboard API is only exposed in secure contexts (HTTPS or localhost) and can be blocked
 * by permission policies (iframes, managed browsers), so we fall back to the legacy `execCommand` copy.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			copyTextWithSelection(text);
			return;
		}
	}
	copyTextWithSelection(text);
}

/**
 * Starts the clipboard write synchronously within the user gesture while the text is still being resolved,
 * which Safari requires for copies that depend on a network call.
 */
export async function copyDeferredTextToClipboard(textPromise: Promise<string>): Promise<void> {
	if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
		try {
			const blobPromise = textPromise.then((text) => new Blob([text], { type: 'text/plain' }));
			await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
			return;
		} catch {
			await copyTextToClipboard(await textPromise);
			return;
		}
	}
	await copyTextToClipboard(await textPromise);
}

/** Mounted inside the open dialog, if any, so its focus trap does not steal the selection. */
function copyTextWithSelection(text: string): void {
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'fixed';
	textarea.style.top = '0';
	textarea.style.left = '0';
	textarea.style.opacity = '0';
	textarea.style.pointerEvents = 'none';

	const activeElement = document.activeElement as HTMLElement | null;
	const container = activeElement?.closest('[role="dialog"]') ?? document.body;
	container.appendChild(textarea);
	textarea.select();
	textarea.setSelectionRange(0, text.length);

	try {
		const isCopied = document.execCommand('copy');
		if (!isCopied) {
			throw new Error('Copy to clipboard is not supported by this browser');
		}
	} finally {
		textarea.remove();
		activeElement?.focus();
	}
}
