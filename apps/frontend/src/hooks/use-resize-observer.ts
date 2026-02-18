import { useEffect } from 'react';

/** Observes the resize of an element */
export const useResizeObserver = (
	ref: React.RefObject<HTMLElement | null>,
	callback: (el: Element) => (() => void) | void,
	deps: React.DependencyList = [],
) => {
	useEffect(() => {
		if (!ref.current) {
			return;
		}

		let cleanup: ReturnType<typeof callback>;

		const observer = new ResizeObserver((entries) => {
			const entry = entries.at(0);
			if (entry) {
				cleanup?.();
				cleanup = callback(entry.target);
			}
		});

		observer.observe(ref.current);

		return () => {
			observer.disconnect();
			cleanup?.();
		};
	}, [ref, ...deps]); // eslint-disable-line
};
