import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface Size {
	width: number;
	height: number;
}

/** The inner size of the element the ref points to, kept in sync with its resizes. */
export function useStageSize<T extends HTMLElement>(): { stageRef: RefObject<T | null>; stage: Size } {
	const stageRef = useRef<T>(null);
	const [stage, setStage] = useState<Size>({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const element = stageRef.current;
		if (!element) {
			return;
		}
		const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight });
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return { stageRef, stage };
}

/** The largest scale at which `content` fits inside `available` in both directions. */
export function fitScale(available: Size, content: Size): number {
	return Math.max(Math.min(available.width / content.width, available.height / content.height), 0);
}
