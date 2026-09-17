import { useEffect, useState } from 'react';
import type { callSubagent } from '@nao/shared/tools';

/** How long the subagent has worked, ticking every second while it is still running. */
export function useSubagentDuration(output: callSubagent.Output | undefined, isSettled: boolean): string | null {
	const startedAt = output?.startedAt;
	const durationMs = output?.durationMs;
	const isTicking = !isSettled && startedAt !== undefined && durationMs === undefined;
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!isTicking) {
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, [isTicking]);

	if (durationMs !== undefined) {
		return formatDuration(durationMs);
	}
	if (isTicking) {
		return formatDuration(Math.max(0, now - startedAt));
	}
	return null;
}

export function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}
