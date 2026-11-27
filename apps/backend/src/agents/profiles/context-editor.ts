import { CONTEXT_EDITOR_ROLE, renderContextEditorPrompt } from '../../components/ai/context-editor-prompt';
import { env } from '../../env';
import { createContextEditorRecommendationTools } from '../../services/context-editor-recommendation-tools';
import { createContextEditorSkillTools } from '../../services/context-editor-skill-tools';
import { createContextEditorTools } from '../../services/context-editor-tools';
import type { DescribedContextHubPage } from '../../services/context-hub-shown-page.service';
import { analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

/**
 * The analytics agent of the chat beside the Context Hub, which also edits context files in the user's changes. It
 * edits the rules and context shared by everyone, so the published RULES.md and the user's memories stay out of its prompt.
 */
export function contextEditorAgent({
	editor,
	shown,
}: {
	editor: { id: string; name: string; email: string };
	shown: DescribedContextHubPage;
}): AgentProfile {
	const hasRecommendations = env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED;
	return {
		source: 'contextEditor',
		tools: analyticsToolsExcluding([], {
			...createContextEditorTools(editor),
			...createContextEditorSkillTools(editor),
			...(hasRecommendations && createContextEditorRecommendationTools(editor)),
		}),
		role: CONTEXT_EDITOR_ROLE,
		promptAppendix: renderContextEditorPrompt({ shown, hasRecommendations }),
		excludesUserRules: true,
		excludesMemories: true,
	};
}
