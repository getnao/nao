import * as logQueries from '../queries/log.queries';

const RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const startLogCleanup = (): ReturnType<typeof setInterval> => {
	const runCleanup = async () => {
		try {
			await logQueries.deleteOldLogs(RETENTION_DAYS);
		} catch (err) {
			console.error('[log-cleanup] failed:', err);
		}
	};

	// Run once on startup, then every 24 hours
	runCleanup();
	return setInterval(runCleanup, CLEANUP_INTERVAL_MS);
};
