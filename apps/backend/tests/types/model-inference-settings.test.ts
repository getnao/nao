import { describe, expect, it } from 'vitest';

import { modelInferenceSettingsSchema, modelSettingsMapSchema } from '../../src/types/llm';

describe('modelInferenceSettingsSchema', () => {
	it('accepts an empty object (all params optional)', () => {
		expect(accepts({})).toBe(true);
	});

	it('accepts a fully populated settings object', () => {
		const accepted = accepts({
			temperature: 0.7,
			topP: 0.9,
			topK: 40,
			maxOutputTokens: 16_000,
			reasoningEffort: 'high',
			thinkingBudgetTokens: 8192,
		});

		expect(accepted).toBe(true);
	});

	it('bounds temperature to 0–2', () => {
		expect(accepts({ temperature: 0 })).toBe(true);
		expect(accepts({ temperature: 2 })).toBe(true);
		expect(accepts({ temperature: -0.1 })).toBe(false);
		expect(accepts({ temperature: 2.1 })).toBe(false);
	});

	it('bounds topP to 0–1', () => {
		expect(accepts({ topP: 1 })).toBe(true);
		expect(accepts({ topP: 1.01 })).toBe(false);
	});

	it('requires topK to be a positive integer', () => {
		expect(accepts({ topK: 1 })).toBe(true);
		expect(accepts({ topK: 0 })).toBe(false);
		expect(accepts({ topK: 1.5 })).toBe(false);
	});

	it('requires maxOutputTokens to be a positive integer', () => {
		expect(accepts({ maxOutputTokens: 1 })).toBe(true);
		expect(accepts({ maxOutputTokens: 0 })).toBe(false);
	});

	it('requires thinkingBudgetTokens to be an integer of at least 1024', () => {
		expect(accepts({ thinkingBudgetTokens: 1024 })).toBe(true);
		expect(accepts({ thinkingBudgetTokens: 1023 })).toBe(false);
		expect(accepts({ thinkingBudgetTokens: 2048.5 })).toBe(false);
	});

	it('restricts reasoningEffort to the known efforts, including minimal', () => {
		for (const effort of ['off', 'minimal', 'low', 'medium', 'high', 'max']) {
			expect(accepts({ reasoningEffort: effort })).toBe(true);
		}
		expect(accepts({ reasoningEffort: 'ultra' })).toBe(false);
	});

	it('accepts all extra provider params together', () => {
		const accepted = accepts({
			textVerbosity: 'low',
			reasoningSummary: 'detailed',
			parallelToolCalls: false,
			maxToolCalls: 20,
			serviceTier: 'flex',
			speed: 'fast',
			inferenceGeo: 'global',
			sendReasoning: true,
			includeThoughts: true,
			safetyThreshold: 'BLOCK_NONE',
			mediaResolution: 'MEDIA_RESOLUTION_HIGH',
			safePrompt: true,
			documentImageLimit: 8,
			documentPageLimit: 64,
		});

		expect(accepted).toBe(true);
	});

	it('restricts the enum extras to their vocabularies', () => {
		expect(accepts({ textVerbosity: 'verbose' })).toBe(false);
		expect(accepts({ reasoningSummary: 'concise' })).toBe(false);
		expect(accepts({ serviceTier: 'turbo' })).toBe(false);
		expect(accepts({ speed: 'slow' })).toBe(false);
		expect(accepts({ inferenceGeo: 'eu' })).toBe(false);
		expect(accepts({ safetyThreshold: 'BLOCK_ALL' })).toBe(false);
		expect(accepts({ mediaResolution: 'MEDIA_RESOLUTION_ULTRA' })).toBe(false);
	});

	it('requires the boolean extras to be booleans', () => {
		expect(accepts({ parallelToolCalls: 'yes' })).toBe(false);
		expect(accepts({ sendReasoning: 1 })).toBe(false);
		expect(accepts({ includeThoughts: false })).toBe(true);
		expect(accepts({ safePrompt: true })).toBe(true);
	});

	it('requires the numeric extras to be positive integers', () => {
		expect(accepts({ maxToolCalls: 1 })).toBe(true);
		expect(accepts({ maxToolCalls: 0 })).toBe(false);
		expect(accepts({ maxToolCalls: 2.5 })).toBe(false);
		expect(accepts({ documentImageLimit: 0 })).toBe(false);
		expect(accepts({ documentPageLimit: 0 })).toBe(false);
	});
});

describe('modelSettingsMapSchema', () => {
	it('accepts a map of model ids to settings', () => {
		const result = modelSettingsMapSchema.safeParse({
			'claude-sonnet-4-6': { reasoningEffort: 'high', maxOutputTokens: 8000 },
			'gpt-5.5': { reasoningEffort: 'medium' },
		});

		expect(result.success).toBe(true);
	});

	it('rejects entries with invalid nested settings', () => {
		const result = modelSettingsMapSchema.safeParse({
			'claude-sonnet-4-6': { thinkingBudgetTokens: 100 },
		});

		expect(result.success).toBe(false);
	});
});

function accepts(settings: Record<string, unknown>): boolean {
	return modelInferenceSettingsSchema.safeParse(settings).success;
}
