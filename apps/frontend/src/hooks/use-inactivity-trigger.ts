import { useEffect, useState } from 'react';

interface InactivityTriggerOptions {
	enabled: boolean;
	delayMs: number;
	resetKey: string;
}

/**
 * Returns `true` once `enabled` has stayed continuously true for `delayMs`.
 * The countdown restarts whenever `enabled` flips or `resetKey` changes, so any
 * fresh activity (new message, chat switch) postpones the trigger.
 */
export function useInactivityTrigger({ enabled, delayMs, resetKey }: InactivityTriggerOptions): boolean {
	const [triggered, setTriggered] = useState(false);

	useEffect(() => {
		setTriggered(false);
		if (!enabled) {
			return;
		}
		const timer = window.setTimeout(() => setTriggered(true), delayMs);
		return () => window.clearTimeout(timer);
	}, [enabled, delayMs, resetKey]);

	return triggered;
}
