import * as logQueries from '../queries/log.queries';
import type { JobHandler } from '../services/scheduler.service';

const RETENTION_DAYS = 7;

export const LOG_CLEANUP_JOB_NAME = 'log.cleanup';

export async function runLogCleanup(): Promise<void> {
	await logQueries.deleteOldLogs(RETENTION_DAYS);
}

export const logCleanupHandler: JobHandler = async () => {
	await runLogCleanup();
};
