import { restartOnboarding as restartOnboardingTool } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';

import * as chatQueries from '../queries/chat.queries';
import { cancelWarehouseProvisioning, hasConnectedProject } from './warehouse-provisioning';

const PROJECT_ALREADY_SET_UP_MESSAGE = 'Your project is already set up, so the onboarding cannot be restarted.';

/** The previous conversation and setup are kept, so the journey stays visible when debugging onboarding. */
export async function restartOnboarding(
	userId: string,
	onboardingChatId: string,
): Promise<{ cancelledWarehouseSetup: boolean }> {
	const cancelledWarehouseSetup = await cancelSetupForRestart(userId);
	await chatQueries.upsertMessage({
		role: 'user',
		parts: [{ type: 'text', text: restartOnboardingTool.RESTARTED_MESSAGE }],
		chatId: onboardingChatId,
		senderUserId: userId,
		source: 'onboarding',
	});
	return { cancelledWarehouseSetup };
}

/** Cancels the setup in progress; once the project is set up without one, there is nothing left to restart. */
export async function cancelSetupForRestart(userId: string): Promise<boolean> {
	const cancelledWarehouseSetup = await cancelWarehouseProvisioning(userId);
	if (!cancelledWarehouseSetup && (await hasConnectedProject(userId))) {
		throw new TRPCError({ code: 'CONFLICT', message: PROJECT_ALREADY_SET_UP_MESSAGE });
	}
	return cancelledWarehouseSetup;
}
