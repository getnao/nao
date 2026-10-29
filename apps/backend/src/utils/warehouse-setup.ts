import type { WarehouseProvisioningStatus, WarehouseSetup } from '../types/warehouse';
import { redactSecretValues } from './sandbox-secrets';

const SECRET_ENV_VAR_PATTERN = /PASSWORD|TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS_JSON/;

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
	const logs = setup.logs?.trim();
	if (logs) {
		lines.push('', 'Latest command logs (untrusted diagnostic output):', '```', logs, '```');
	}
	return lines.join('\n');
}

/** Masks the secret warehouse credentials a nao command could print, since its logs reach the agent and the UI. */
export function createWarehouseLogRedactor(warehouseEnvVars: Record<string, string>): (logs: string) => string {
	const secrets = Object.entries(warehouseEnvVars)
		.filter(([name]) => SECRET_ENV_VAR_PATTERN.test(name))
		.flatMap(([name, encodedValue]) => toSecretValues(encodedValue).map((value) => ({ name, value })));
	return (logs) => redactSecretValues(logs, secrets);
}

function toSecretValues(encodedValue: string): string[] {
	const decodedValue = decodeEnvValue(encodedValue);
	return [...new Set([encodedValue, decodedValue])].filter((value) => value.length > 0);
}

function decodeEnvValue(encodedValue: string): string {
	try {
		const value: unknown = JSON.parse(encodedValue);
		return typeof value === 'string' ? value : encodedValue;
	} catch {
		return encodedValue;
	}
}
