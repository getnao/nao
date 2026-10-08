import { describe, expect, it } from 'vitest';

import { renderOnboardingSystemPrompt } from '../src/components/ai/onboarding-system-prompt';

describe('onboarding system prompt', () => {
	it('treats the first message as the answer to the frontend flow selection', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('Treat the first user message as their answer to that question');
		expect(prompt).toContain('Do not ask it again');
		expect(prompt).not.toContain('Start off all conversations with a clarification');
	});

	it('updates progress when the user changes setup flows', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('the user may change their selected setup flow at any time');
		expect(prompt).toContain('Immediately call onboarding_progress for the newly selected flow');
		expect(prompt).toContain('Call onboarding_progress even when the same flow and step were recorded earlier');
		expect(prompt).toContain('Changing flows may also use a lower numerical step');
		expect(prompt).toContain('if they clarify that they have not run the deploy command, record step 3');
	});

	it('offers popular databases first and handles unsupported providers', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('- Options: "BigQuery", "DuckDB", "Postgres", "Snowflake", "Other"');
		expect(prompt).toContain('Respond exactly: "Please tell me which database you are using."');
		expect(prompt).toContain('Do not call clarification or any other tool');
		expect(prompt).toContain('Do not invent or guess a provider identifier');
		expect(prompt).toContain('Do not call request_warehouse_credentials');
	});

	it('routes cloud DuckDB connections through private MotherDuck credentials', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('treat the selected database provider as "motherduck"');
		expect(prompt).toContain('Do not continue the database connection flow');
		expect(prompt).not.toContain('make their DuckDB file public');
	});

	it('collects optional business context in one open-ended question', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('warehouse synchronization is continuing in the background');
		expect(prompt).toContain('write one or two sentences, paste a link to your company website, or reply Skip');
		expect(prompt).toContain('The direct open-ended business-context question');
		expect(prompt).toContain('"additionalContext": "<their complete answer>"');
		expect(prompt).toContain('If they reply Skip, use an empty "businessContext" object');
		expect(prompt).not.toContain('companyDescription');
	});

	it('ends the agent turn while project finalization continues in the background', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('finalizing the connection in the background');
		expect(prompt).toContain('End the turn and wait');
		expect(prompt).toContain('Do not claim that onboarding is complete');
	});

	it('shows only the installer selected by the user', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('- Options: "uv (recommended)", "pip (Python 3.10+)"');
		expect(prompt).toContain('Call onboarding_command only for the installer the user selected');
	});

	it('explains the local project directory placeholder', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain(
			'Tell them to replace <your-project-folder> with the directory containing nao_config.yaml',
		);
	});

	it('aligns GitHub progress with the events reported by the import card', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('Call onboarding_progress with flow "github" and step 2');
		expect(prompt).toContain('GitHub: 1 Connect GitHub, 2 Import repository');
		expect(prompt).not.toContain('flow "github" and step 4');
	});
});
