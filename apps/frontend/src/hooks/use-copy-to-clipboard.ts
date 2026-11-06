import { useCallback, useRef, useState } from 'react';
import { copyTextToClipboard } from '@/lib/clipboard';

export const useCopyToClipboard = (timeout = 2000) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const copy = useCallback(
		async (text: string) => {
			await copyTextToClipboard(text);
			setIsCopied(true);
			clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(() => setIsCopied(false), timeout);
		},
		[timeout],
	);

	return { isCopied, copy };
};
