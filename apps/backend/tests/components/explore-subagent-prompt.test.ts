import { describe, expect, it } from 'vitest';

import { ExploreSubagentPrompt } from '../../src/components/ai/explore-subagent-prompt';
import { renderToMarkdown } from '../../src/lib/markdown';

describe('ExploreSubagentPrompt user rules', () => {
	it.each([
		{ isUserRulesExcerpt: false, structure: 'so do not read the file', section: 'never read `RULES.md`' },
		{ isUserRulesExcerpt: true, structure: 'read it for project conventions', section: 'Read the file only when' },
	])(
		'points the agent at RULES.md only when the injected rules are an excerpt ($isUserRulesExcerpt)',
		({ isUserRulesExcerpt, structure, section }) => {
			const markdown = renderToMarkdown(
				ExploreSubagentPrompt({ userRules: 'Always answer in euros.', isUserRulesExcerpt }),
			);
			const rulesLine = markdown.split('\n').find((line) => line.startsWith('- `RULES.md` —')) ?? '';

			expect(rulesLine).toContain(structure);
			expect(markdown.slice(markdown.indexOf('## User Rules'))).toContain(section);
		},
	);
});
