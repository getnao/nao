import { useCallback, useRef, useState } from 'react';

export const useCopyToClipboard = (timeout = 2000) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const copy = useCallback(
		async (text: string) => {
			await navigator.clipboard.writeText(text);
			setIsCopied(true);
			clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(() => setIsCopied(false), timeout);
		},
		[timeout],
	);

	return { isCopied, copy };
};
