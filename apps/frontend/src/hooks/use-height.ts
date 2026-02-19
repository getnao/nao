import { useState } from 'react';
import { useResizeObserver } from './use-resize-observer';

export const useHeight = (ref: React.RefObject<HTMLElement | null>, deps: React.DependencyList = []) => {
	const [height, setHeight] = useState(0);

	useResizeObserver(
		ref,
		(el) => {
			setHeight(el.getBoundingClientRect().height);
		},
		deps,
	);

	return height;
};
