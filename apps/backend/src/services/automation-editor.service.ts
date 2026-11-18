import { env } from '../env';
import * as automationQueries from '../queries/automation.queries';
import * as chatQueries from '../queries/chat.queries';
import { HandlerError } from '../utils/error';
import { assertUserGroupFeature } from './user-group-feature-access.service';

const NEW_AUTOMATION_CHAT_TITLE = 'New automation';

interface AutomationEditorRequest {
	userId: string;
	projectId: string;
}

/** Opens the chat beside the form of an automation, or of a new one when there is no id. */
export async function startAutomationEditChat({
	userId,
	projectId,
	automationId,
}: AutomationEditorRequest & { automationId?: string }): Promise<{ chatId: string }> {
	const automation = await assertCanEditAutomation({ userId, projectId, automationId: automationId ?? null });
	const title = automation?.title ?? NEW_AUTOMATION_CHAT_TITLE;
	const chat = await chatQueries.createForkedChat(
		{
			projectId,
			userId,
			title,
			forkMetadata: {
				type: chatQueries.AUTOMATION_EDIT_FORK_TYPE,
				id: automation?.id ?? '',
				title,
				authorName: '',
			},
		},
		[],
	);
	return { chatId: chat.id };
}

/** The automation a message from an editing chat works on, or null for a new one, once the user may edit it. */
export async function resolveEditedAutomationId({
	userId,
	projectId,
	chatId,
}: AutomationEditorRequest & { chatId: string | undefined }): Promise<string | null> {
	const automationId = await getEditedAutomationId(chatId);
	await assertCanEditAutomation({ userId, projectId, automationId });
	return automationId;
}

async function getEditedAutomationId(chatId: string | undefined): Promise<string | null> {
	const forkMetadata = chatId ? await chatQueries.getForkMetadata(chatId) : null;
	if (forkMetadata?.type !== chatQueries.AUTOMATION_EDIT_FORK_TYPE) {
		throw new HandlerError('BAD_REQUEST', 'An automation can only be edited from its editing chat.');
	}
	return forkMetadata.id || null;
}

/** Existing automations are edited by their owner; new ones need the automation creation feature. */
async function assertCanEditAutomation({
	userId,
	projectId,
	automationId,
}: AutomationEditorRequest & { automationId: string | null }) {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		throw new HandlerError('FORBIDDEN', 'Automations are disabled on this instance.');
	}
	if (!automationId) {
		await assertUserGroupFeature(projectId, userId, 'automationCreation');
		return null;
	}
	const automation = await automationQueries.getAutomation(projectId, userId, automationId);
	if (!automation) {
		throw new HandlerError('NOT_FOUND', `Automation not found: ${automationId}`);
	}
	return automation;
}
