import { describe, expect, it } from 'vitest';

import { renderContextRecommendationsSystemPrompt } from '../src/components/ai/context-recommendations-system-prompt';

describe('context recommendations system prompt', () => {
	it('renders only configured project context and names repositories', () => {
		const markdown = renderContextRecommendationsSystemPrompt({
			templates: ['columns'],
			contextPresence: {
				rules: true,
				semantics: false,
				docs: false,
				notionDocs: false,
				databases: true,
			},
			linkedRepos: [
				{
					name: 'dbt',
					contextPath: 'repos/dbt',
					url: null,
					branch: null,
					localPath: null,
					repoFullName: null,
					provider: null,
				},
			],
		});

		expect(markdown).toContain('\n- `RULES.md` —');
		expect(markdown).not.toContain('\n- `semantics/` —');
		expect(markdown).not.toContain('\n- `docs/` —');
		expect(markdown).toContain('\n- `repos/dbt/` —');
		expect(markdown).toContain('\n- `databases/` —');
		expect(markdown).toContain('\n\t- `annotations.md` —');
		expect(markdown).toContain('\n\t- `columns.md` —');
		expect(markdown).not.toContain('\n\t- `preview.md` —');
		expect(markdown).not.toContain('\n\t- `profiling.md` —');
		expect(markdown).not.toContain('\n\t- `query_history.md` —');
		expect(markdown).not.toContain('\n\t- `ai_summary.md` —');
	});

	it('describes all folders and templates when project context is unknown', () => {
		const markdown = renderContextRecommendationsSystemPrompt();

		for (const contextPath of ['RULES.md', 'semantics/', 'docs/', 'databases/']) {
			expect(markdown).toContain(`\n- \`${contextPath}\` —`);
		}
		for (const template of ['columns.md', 'preview.md', 'profiling.md', 'query_history.md', 'ai_summary.md']) {
			expect(markdown).toContain(`\n\t- \`${template}\` —`);
		}
	});

	it('includes custom instructions when configured', () => {
		const markdown = renderContextRecommendationsSystemPrompt({
			customInstructions: 'Prioritize recommendations about revenue definitions.',
		});

		expect(markdown).toContain('## Custom instructions');
		expect(markdown).toContain('Prioritize recommendations about revenue definitions.');
	});

	it('omits custom instructions when blank', () => {
		const markdown = renderContextRecommendationsSystemPrompt({ customInstructions: '   ' });

		expect(markdown).not.toContain('## Custom instructions');
	});
});
