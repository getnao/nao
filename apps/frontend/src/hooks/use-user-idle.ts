import { useEffect, useState } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * Becomes `true` once the user went `delayMs` without clicking, typing or scrolling while `enabled`,
 * then stays `true` so later activity does not take back what it revealed.
 */
export function useUserIdle({ enabled, delayMs }: { enabled: boolean; delayMs: number }): boolean {
	const [hasBeenIdle, setHasBeenIdle] = useState(false);

	useEffect(() => {
		if (!enabled || hasBeenIdle) {
			return;
		}

		let timer: number | undefined;
		const restart = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => setHasBeenIdle(true), delayMs);
		};

		for (const type of ACTIVITY_EVENTS) {
			window.addEventListener(type, restart, { capture: true, passive: true });
		}
		restart();

		return () => {
			window.clearTimeout(timer);
			for (const type of ACTIVITY_EVENTS) {
				window.removeEventListener(type, restart, { capture: true });
			}
		};
	}, [enabled, hasBeenIdle, delayMs]);

	return hasBeenIdle;
}
