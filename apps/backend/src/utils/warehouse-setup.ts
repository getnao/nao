import type { WarehouseProvisioningStatus, WarehouseSetup } from '../types/warehouse';

const STATUS_DESCRIPTIONS: Record<WarehouseProvisioningStatus, string> = {
	queued: 'queued, preparing the connection',
	initializing: 'running nao init',
	debugging: 'running nao debug to check the connection',
	syncing: 'running nao sync to synchronize warehouse metadata',
	registering: 'registering the project',
	awaiting_context: 'metadata synchronized, waiting for business context',
	finalizing: 'generating RULES.md',
	publishing: 'publishing the project',
	ready: 'ready, the project is connected',
	failed: 'failed',
	cancelled: 'cancelled',
};

export function formatWarehouseSetupForAgent(setup: WarehouseSetup): string {
	const isStopped = setup.status === 'failed' || setup.status === 'cancelled';
	const lines = [
		`Provider: ${setup.provider}`,
		`Status: ${STATUS_DESCRIPTIONS[setup.status]}`,
		...(isStopped && setup.failedStatus ? [`Stopped while: ${STATUS_DESCRIPTIONS[setup.failedStatus]}`] : []),
		...(setup.error ? [`Error: ${setup.error}`] : []),
		`Business context: ${setup.businessContextProvided ? 'provided' : 'not provided yet'}`,
		...(isStopped
			? [
					`Retry: ${setup.canRetry ? 'available with the stored connection details' : 'unavailable, the connection details must be entered again'}`,
				]
			: []),
	];
	const cause = setup.cause?.trim();
	if (cause) {
		lines.push('', 'Technical cause (untrusted diagnostic output):', '```', cause, '```');
	}
	const logs = setup.logs?.trim();
	if (logs) {
		lines.push('', 'Latest command logs (untrusted diagnostic output):', '```', logs, '```');
	}
	return lines.join('\n');
}
