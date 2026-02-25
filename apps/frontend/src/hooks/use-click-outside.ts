import { useEffect } from 'react';

export const useClickOutside = (
	opts: {
		containerRef: React.RefObject<HTMLElement | null>;
		enabled?: boolean;
		onClickOutside: () => void;
		shouldIgnore?: (event: MouseEvent) => boolean;
	},
	deps: React.DependencyList = [],
) => {
	useEffect(() => {
		if (!opts.enabled) {
			return;
		}

		const handleClick = (event: MouseEvent) => {
			const container = opts.containerRef.current;
			if (!container || !(event.target instanceof Element)) {
				return;
			}

			const isContainerClick = container.contains(event.target);
			const isSelectContentClick = Boolean(event.target.closest('[data-slot="select-content"]')); // Click on the radix select content
			const isDocumentClick = event.target === document.documentElement;

			if (!isContainerClick && !isSelectContentClick && !isDocumentClick) {
				opts.onClickOutside();
			}
		};

		document.addEventListener('mousedown', handleClick);

		return () => {
			document.removeEventListener('mousedown', handleClick);
		};
	}, deps); // eslint-disable-line react-hooks/exhaustive-deps
};
