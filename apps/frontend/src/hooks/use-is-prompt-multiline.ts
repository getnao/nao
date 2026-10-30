import { useState } from 'react';
import { useResizeObserver } from './use-resize-observer';

/** Whether the prompt within the container wraps or breaks onto more than one line. */
export const useIsPromptMultiline = (containerRef: React.RefObject<HTMLElement | null>) => {
	const [isMultiline, setIsMultiline] = useState(false);

	useResizeObserver(containerRef, (container) => {
		const input = container.querySelector<HTMLElement>('.prompt-input');
		setIsMultiline(input ? spansSeveralLines(input) : false);
	});

	return isMultiline;
};

function spansSeveralLines(element: HTMLElement): boolean {
	const style = getComputedStyle(element);
	const lineHeight = parseFloat(style.lineHeight);
	const contentHeight = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	return contentHeight > lineHeight * 1.5;
}
