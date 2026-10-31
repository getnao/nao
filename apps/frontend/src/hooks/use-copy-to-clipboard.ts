import { useCallback, useRef, useState } from 'react';

export const useCopyToClipboard = (timeout = 2000) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const copy = useCallback(
		async (text: string) => {
			await copyText(text);
			setIsCopied(true);
			clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(() => setIsCopied(false), timeout);
		},
		[timeout],
	);

	return { isCopied, copy };
};

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		return;
	} catch {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.readOnly = true;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.append(textarea);
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		try {
			if (!document.execCommand('copy')) {
				throw new Error('Clipboard copy failed');
			}
		} finally {
			textarea.remove();
		}
	}
}
