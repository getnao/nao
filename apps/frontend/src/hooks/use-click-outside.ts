import { useEffect } from 'react';

export const useClickOutside = (
	opts: {
		ref: React.RefObject<HTMLElement | null>;
		enabled?: boolean;
		onClickOutside: () => void;
	},
	deps: React.DependencyList = [],
) => {
	useEffect(() => {
		if (!opts.enabled) {
			return;
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (opts.ref.current && !opts.ref.current.contains(event.target as Node)) {
				opts.onClickOutside();
			}
		};

		document.addEventListener('mousedown', handleClickOutside);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, deps); // eslint-disable-line react-hooks/exhaustive-deps
};
