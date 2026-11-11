import type { AutomationDraft } from '@nao/shared/automation-draft';

import { renderAutomationEditorPrompt } from '../../components/ai/automation-editor-prompt';
import { createAutomationEditorTools } from '../../services/automation-editor-tools';
import { analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

/** The analytics agent of the chat beside an automation's form, which it can read and change. */
export function automationEditorAgent({
	draft,
	automationId,
	canUseChatFeedback,
}: {
	draft: AutomationDraft;
	automationId: string | null;
	canUseChatFeedback: boolean;
}): AgentProfile {
	return {
		source: 'web',
		tools: analyticsToolsExcluding([], createAutomationEditorTools({ draft, automationId, canUseChatFeedback })),
		promptAppendix: renderAutomationEditorPrompt({ isSaved: automationId !== null }),
	};
}
