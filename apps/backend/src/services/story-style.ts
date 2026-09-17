import { DEFAULT_STORY_STYLE, type StoryStyle } from '@nao/shared/dbt-charts';

import type { AgentSettings } from '../types/agent-settings';
import { isDbtChartsAvailable } from './dbt-charts-status';

/** The admin's choice, narrowed to markdown when the dbt Charts renderer is not installed on this instance. */
export function resolveStoryStyle(agentSettings: AgentSettings | null | undefined): StoryStyle {
	const style = agentSettings?.stories?.style ?? DEFAULT_STORY_STYLE;
	if (style !== 'markdown' && !isDbtChartsAvailable()) {
		return 'markdown';
	}
	return style;
}
