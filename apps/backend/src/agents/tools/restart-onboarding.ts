import { restartOnboarding } from '@nao/shared/tools';

import { cancelSetupForRestart } from '../../services/onboarding-restart';
import { createTool } from '../../utils/tools';

export default createTool<restartOnboarding.Input, restartOnboarding.Output>({
	description:
		'Restart the onboarding from scratch: cancel any warehouse setup in progress and move the user to a new onboarding conversation. The turn ends here.',
	inputSchema: restartOnboarding.InputSchema,
	outputSchema: restartOnboarding.OutputSchema,
	execute: async (_input, context) => ({
		_version: '1',
		cancelledWarehouseSetup: await cancelSetupForRestart(context.userId),
	}),
	toModelOutput: () => ({
		type: 'text',
		value: 'The onboarding restarted. The user continues in a new onboarding conversation; the turn ends here.',
	}),
});
