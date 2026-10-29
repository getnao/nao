import { OnboardingStatusLine } from './onboarding-status-line';
import type { waitForWarehouseSetup } from '@nao/shared/tools';
import type { OnboardingStatusTone } from './onboarding-status-line';
import type { ToolCallComponentProps } from '..';

import { useToolCallContext } from '@/contexts/tool-call';

const OUTCOME_STATUS: Record<waitForWarehouseSetup.Outcome, { tone: OnboardingStatusTone; label: string }> = {
	not_started: { tone: 'neutral', label: 'Warehouse setup not started yet' },
	running: { tone: 'neutral', label: 'Warehouse setup continues in the background' },
	connection_verified: { tone: 'success', label: 'Warehouse connection verified' },
	ready: { tone: 'success', label: 'Warehouse setup complete' },
	failed: { tone: 'error', label: 'Warehouse setup stopped' },
	cancelled: { tone: 'error', label: 'Warehouse setup cancelled' },
};

export function WaitForWarehouseSetupToolCall({ toolPart }: ToolCallComponentProps<'wait_for_warehouse_setup'>) {
	const { isSettled } = useToolCallContext();

	if (toolPart.state === 'output-available') {
		return <OnboardingStatusLine {...OUTCOME_STATUS[toolPart.output.outcome]} />;
	}
	if (toolPart.errorText) {
		return (
			<OnboardingStatusLine
				tone='error'
				label='Could not check the warehouse setup'
				detail={toolPart.errorText}
			/>
		);
	}
	return isSettled ? <OnboardingStatusLine tone='neutral' label='Stopped following the warehouse setup' /> : null;
}

export function RetryWarehouseSetupToolCall({ toolPart }: ToolCallComponentProps<'retry_warehouse_setup'>) {
	const { isSettled } = useToolCallContext();

	if (toolPart.state === 'output-available') {
		return <OnboardingStatusLine tone='success' label='Warehouse setup restarted' />;
	}
	if (toolPart.errorText) {
		return (
			<OnboardingStatusLine
				tone='error'
				label='Could not restart the warehouse setup'
				detail={toolPart.errorText}
			/>
		);
	}
	return isSettled ? (
		<OnboardingStatusLine tone='neutral' label='Warehouse setup restart interrupted' />
	) : (
		<OnboardingStatusLine tone='running' label='Restarting the warehouse setup' />
	);
}
