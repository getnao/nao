import { useEffect, useState } from 'react';

/** Whether the element has scrolled out of view above its scroll container, as opposed to not being reached yet. */
export function useIsScrolledAbove(element: HTMLElement | null): boolean {
	const [isScrolledAbove, setIsScrolledAbove] = useState(false);

	useEffect(() => {
		if (!element || typeof IntersectionObserver === 'undefined') {
			setIsScrolledAbove(false);
			return;
		}
		const observer = new IntersectionObserver(([entry]) => {
			setIsScrolledAbove(!entry.isIntersecting && entry.boundingClientRect.top < window.innerHeight / 2);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);

	return isScrolledAbove;
}
