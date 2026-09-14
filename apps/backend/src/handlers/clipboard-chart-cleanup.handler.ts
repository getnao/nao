import { deleteExpiredClipboardCharts } from '../queries/chart-image';
import type { JobHandler } from '../services/scheduler.service';

export const CLIPBOARD_CHART_CLEANUP_JOB_NAME = 'chart.clipboard.cleanup';

export async function runClipboardChartCleanup(): Promise<void> {
	await deleteExpiredClipboardCharts();
}

export const clipboardChartCleanupHandler: JobHandler = async () => {
	await runClipboardChartCleanup();
};
