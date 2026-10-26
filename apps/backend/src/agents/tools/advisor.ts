import { anthropic } from '@ai-sdk/anthropic';

export const ADVISOR_TOOL_NAME = 'advisor';

export function createAdvisorTools(advisorModelId: string | undefined): Record<string, unknown> {
	if (!advisorModelId) {
		return {};
	}
	return { [ADVISOR_TOOL_NAME]: anthropic.tools.advisor_20260301({ model: advisorModelId }) };
}
