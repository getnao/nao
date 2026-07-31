import { useEffect, useRef, useState } from 'react';

interface InactivityTriggerOptions {
	enabled: boolean;
	delayMs: number;
	resetKey: string;
	/** Pauses the countdown and keeps the trigger off, e.g. while the user is typing. */
	isPaused?: boolean;
	/** Called when the countdown pauses while the trigger was already on, i.e. the user ignored it. */
	onIgnored?: () => void;
}

/**
 * Returns `true` once `enabled` has stayed continuously true — and `isPaused` false — for `delayMs`.
 * The countdown restarts from zero whenever `enabled`, `isPaused`, `delayMs` or `resetKey` change, so
 * any fresh activity (new message, chat switch, typing) postpones the trigger.
 */
export function useInactivityTrigger({
	enabled,
	delayMs,
	resetKey,
	isPaused = false,
	onIgnored,
}: InactivityTriggerOptions): boolean {
	const [triggered, setTriggered] = useState(false);
	const isCountingDown = enabled && !isPaused;

	useEffect(() => {
		setTriggered(false);
		if (!isCountingDown) {
			return;
		}
		const timer = window.setTimeout(() => setTriggered(true), delayMs);
		return () => window.clearTimeout(timer);
	}, [isCountingDown, delayMs, resetKey]);

	useIgnoredNotifier({ triggered, isPaused, resetKey, onIgnored });

	return triggered;
}

/** Reports a pause that interrupted an already visible trigger, so callers can back off next time. */
function useIgnoredNotifier({
	triggered,
	isPaused,
	resetKey,
	onIgnored,
}: {
	triggered: boolean;
	isPaused: boolean;
	resetKey: string;
	onIgnored: (() => void) | undefined;
}) {
	const wasTriggered = useRef(false);
	const onIgnoredRef = useRef(onIgnored);

	useEffect(() => {
		onIgnoredRef.current = onIgnored;
	});

	useEffect(() => {
		if (triggered) {
			wasTriggered.current = true;
		}
	}, [triggered]);

	useEffect(() => {
		wasTriggered.current = false;
	}, [resetKey]);

	useEffect(() => {
		if (!isPaused || !wasTriggered.current) {
			return;
		}
		wasTriggered.current = false;
		onIgnoredRef.current?.();
	}, [isPaused]);
}
