import { requestWarehouseCredentials } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { renderOnboardingSystemPrompt } from '../../src/components/ai/onboarding-system-prompt';

describe('onboarding system prompt', () => {
	it('treats the first message as the answer to the frontend flow selection', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('Treat the first user message as their answer to that question');
		expect(prompt).toContain('Do not ask it again');
		expect(prompt).toContain('Would you like to import a project or simply connect your warehouse?');
		expect(prompt).not.toContain('Start off all conversations with a clarification');
	});

	it('offers local-agent setup when the user has no project', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain(
			'- Options: "Import from GitHub", "Import a local project", "I don\'t have a project yet"',
		);
		expect(prompt).toContain('- Options: "Let my local agent do it", "Show me the step-by-step guide"');
		expect(prompt).toContain('Call onboarding_agent_prompt with this exact multiline prompt');
		expect(prompt).toContain('ABOUT NAO');
		expect(prompt).toContain('Read and follow the installed setup-context skill');
		expect(prompt).toContain('nao deploy <nao-cloud-url> --api-key <deploy-key>');
		expect(prompt).not.toContain('Give them this exact prompt in a Markdown code block');
		expect(prompt).toContain('Continue at NEW PROJECT DEPLOYMENT');
	});

	it('updates progress when the user changes setup flows', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('the user may change their selected setup flow at any time');
		expect(prompt).toContain('Immediately call onboarding_progress for the newly selected flow');
		expect(prompt).toContain('Call onboarding_progress even when the same flow and step were recorded earlier');
		expect(prompt).toContain('Changing flows may also use a lower numerical step');
		expect(prompt).toContain('if they clarify that they have not run the deploy command, record step 3');
	});

	it('offers all supported databases and handles unsupported providers', () => {
		const prompt = renderOnboardingSystemPrompt();

		expect(prompt).toContain('Call request_warehouse_selection to ask which database the user is using');
		expect(prompt).toContain('- DuckDB (special flow below)');
		for (const provider of requestWarehouseCredentials.PROVIDERS) {
			const label = requestWarehouseCredentials.WAREHOUSE_PROVIDER_LABELS[provider];
			const aliases = requestWarehouseCredentials.WAREHOUSE_PROVIDER_ALIASES[provider] ?? [];
			expect(prompt).toContain(`- ${[label, ...aliases].join(' or ')} (provider "${provider}")`);
		}
		expect(prompt).not.toContain('If the user chooses "Other"');
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
