import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { getTools } from '../src/agents/tools';
import { buildStoryToolDescription } from '../src/agents/tools/story';
import type { AgentSettings } from '../src/types/agent-settings';

describe('story plugin tool description', () => {
	it('does not mention plugins when story plugins are disabled', () => {
		expect(buildStoryToolDescription().toLowerCase()).not.toContain('plugin');
		expect(storyDescription({ storyPlugins: { enabled: false } }).toLowerCase()).not.toContain('plugin');
	});

	it('documents the plugin contract and restrictions when enabled', () => {
		const description = storyDescription({ storyPlugins: { enabled: true } });

		expect(description).toContain('<plugin title="...">...</plugin>');
		expect(description).toContain('export default function render(element)');
		expect(description).toContain('self-contained vanilla JavaScript');
		expect(description).toContain('Do not use imports or make network calls');
		expect(description).toContain('only when built-in chart, table, map, or markdown blocks cannot express');
		expect(description).toContain('<plugin title="Counter">');
	});
});

function storyDescription(agentSettings: AgentSettings): string {
	const storyTool = getTools(agentSettings, undefined, { testMode: true }).story as { description?: string };
	return storyTool.description ?? '';
}
