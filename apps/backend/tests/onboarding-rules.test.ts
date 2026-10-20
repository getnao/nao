import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	getProjectById: vi.fn(),
	resolveProviderModel: vi.fn(),
}));

vi.mock('ai', () => ({
	generateText: mocks.generateText,
}));

vi.mock('../src/agents/providers', () => ({
	disableModelReasoning: () => ({ model: 'test-model' }),
}));

vi.mock('../src/agents/telemetry', () => ({
	llmTelemetry: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/utils/llm', () => ({
	resolveProviderModel: mocks.resolveProviderModel,
}));

vi.mock('../src/utils/safe-fetch', () => ({
	safeFetch: vi.fn(),
}));

import { generateOnboardingRules } from '../src/services/onboarding-rules';

let projectPath: string;

beforeEach(() => {
	vi.clearAllMocks();
	projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-rules-test-'));
	mocks.getProjectById.mockResolvedValue({ id: 'project-1', path: projectPath });
	mocks.resolveProviderModel.mockResolvedValue({});
	mocks.generateText.mockResolvedValue({ text: '# Generated rules' });
});

afterEach(() => {
	fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('generateOnboardingRules', () => {
	it('uses the write-context-rules skill and template', async () => {
		await generateOnboardingRules(
			'project-1',
			{ additionalContext: 'A bicycle rental company.' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			'model-project-1',
		);

		const systemPrompt = mocks.generateText.mock.calls[0]?.[0].system as string;
		expect(systemPrompt).toContain('# write-context-rules');
		expect(systemPrompt).toContain('This skill is the only one that writes to `RULES.md`.');
		expect(systemPrompt).toContain('## Automated onboarding execution');
		expect(systemPrompt).toContain('## RULES.md template');
		expect(systemPrompt).toContain('## Business overview');
		expect(systemPrompt).not.toContain('The document should:');
		expect(fs.readFileSync(path.join(projectPath, 'RULES.md'), 'utf8')).toBe('# Generated rules\n');
	});
});
