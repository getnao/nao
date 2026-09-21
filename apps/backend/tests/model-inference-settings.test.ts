import { describe, expect, it } from 'vitest';

import { modelInferenceSettingsSchema, modelSettingsMapSchema } from '../src/types/llm';

describe('modelInferenceSettingsSchema', () => {
	it('accepts an empty object (all params optional)', () => {
		expect(modelInferenceSettingsSchema.safeParse({}).success).toBe(true);
	});

	it('accepts a fully populated settings object', () => {
		const result = modelInferenceSettingsSchema.safeParse({
			temperature: 0.7,
			topP: 0.9,
			topK: 40,
			maxOutputTokens: 16_000,
			reasoningEffort: 'high',
			thinkingBudgetTokens: 8192,
		});

		expect(result.success).toBe(true);
	});

	it('bounds temperature to 0–2', () => {
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 0 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 2 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: -0.1 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 2.1 }).success).toBe(false);
	});

	it('bounds topP to 0–1', () => {
		expect(modelInferenceSettingsSchema.safeParse({ topP: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ topP: 1.01 }).success).toBe(false);
	});

	it('requires topK to be a positive integer', () => {
		expect(modelInferenceSettingsSchema.safeParse({ topK: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ topK: 0 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ topK: 1.5 }).success).toBe(false);
	});

	it('requires maxOutputTokens to be a positive integer', () => {
		expect(modelInferenceSettingsSchema.safeParse({ maxOutputTokens: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ maxOutputTokens: 0 }).success).toBe(false);
	});

	it('requires thinkingBudgetTokens to be an integer of at least 1024', () => {
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 1024 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 1023 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 2048.5 }).success).toBe(false);
	});

	it('restricts reasoningEffort to the known efforts, including minimal', () => {
		for (const effort of ['off', 'minimal', 'low', 'medium', 'high', 'max']) {
			expect(modelInferenceSettingsSchema.safeParse({ reasoningEffort: effort }).success).toBe(true);
		}
		expect(modelInferenceSettingsSchema.safeParse({ reasoningEffort: 'ultra' }).success).toBe(false);
	});

	it('accepts all extra provider params together', () => {
		const result = modelInferenceSettingsSchema.safeParse({
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

		expect(result.success).toBe(true);
	});

	it('restricts the enum extras to their vocabularies', () => {
		expect(modelInferenceSettingsSchema.safeParse({ textVerbosity: 'verbose' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ reasoningSummary: 'concise' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ serviceTier: 'turbo' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ speed: 'slow' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ inferenceGeo: 'eu' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ safetyThreshold: 'BLOCK_ALL' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ mediaResolution: 'MEDIA_RESOLUTION_ULTRA' }).success).toBe(
			false,
		);
	});

	it('requires the boolean extras to be booleans', () => {
		expect(modelInferenceSettingsSchema.safeParse({ parallelToolCalls: 'yes' }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ sendReasoning: 1 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ includeThoughts: false }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ safePrompt: true }).success).toBe(true);
	});

	it('requires the numeric extras to be positive integers', () => {
		expect(modelInferenceSettingsSchema.safeParse({ maxToolCalls: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ maxToolCalls: 0 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ maxToolCalls: 2.5 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ documentImageLimit: 0 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ documentPageLimit: 0 }).success).toBe(false);
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
