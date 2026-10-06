import { describe, expect, it } from 'vitest';

import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	getTranscribeModels,
	supportsTranscription,
} from '../src/agents/transcribe.providers';

describe('supportsTranscription', () => {
	it('is declared on the provider kind, not a separate registry', () => {
		expect(supportsTranscription('openai')).toBe(true);
		expect(supportsTranscription('groq')).toBe(true);
		expect(supportsTranscription('openrouter')).toBe(true);
		expect(supportsTranscription('openaiCompatible')).toBe(true);
		expect(supportsTranscription('anthropic')).toBe(false);
	});

	it('inherits the capability on named openaiCompatible instances', () => {
		expect(supportsTranscription('openaiCompatible/my-stt')).toBe(true);
	});
});

describe('getTranscribeModels', () => {
	it('lists whisper models for groq', () => {
		expect(getTranscribeModels('groq').map((m) => m.id)).toEqual(['whisper-large-v3', 'whisper-large-v3-turbo']);
	});

	it('has no fixed catalog on openaiCompatible', () => {
		expect(getTranscribeModels('openaiCompatible')).toEqual([]);
	});
});

describe('getDefaultTranscribeModelId', () => {
	it('marks a default model per provider', () => {
		expect(getDefaultTranscribeModelId('openai')).toBe('gpt-4o-mini-transcribe');
		expect(getDefaultTranscribeModelId('groq')).toBe('whisper-large-v3');
		expect(getDefaultTranscribeModelId('openrouter')).toBe('openai/whisper-1');
	});

	it('is empty when the endpoint defines its own catalog', () => {
		expect(getDefaultTranscribeModelId('openaiCompatible')).toBe('');
	});
});

describe('createTranscribeModel', () => {
	it('builds transcription through the OpenAI audio API for any capable provider', () => {
		for (const provider of ['groq', 'openrouter', 'openaiCompatible/my-stt'] as const) {
			const model = createTranscribeModel(provider, { apiKey: 'k', baseURL: 'http://x/v1' }, 'whisper-large-v3');
			expect(model.provider).toBe('openai.transcription');
			expect(model.modelId).toBe('whisper-large-v3');
		}
	});

	it('uses the provider default endpoint when no base URL is set', () => {
		const model = createTranscribeModel('openai', { apiKey: 'k' }, 'whisper-1');
		expect(model.provider).toBe('openai.transcription');
		expect(model.modelId).toBe('whisper-1');
	});

	it('accepts keyless endpoints via a placeholder key', () => {
		const model = createTranscribeModel(
			'openaiCompatible/local',
			{ apiKey: '', baseURL: 'http://x/v1' },
			'whisper',
		);
		expect(model.provider).toBe('openai.transcription');
	});

	it('throws when an openaiCompatible provider has no base URL', () => {
		expect(() =>
			createTranscribeModel('openaiCompatible/my-stt', { apiKey: 'k', baseURL: undefined }, 'whisper'),
		).toThrow('needs a base URL');
	});

	it('throws for a bare openaiCompatible with no base URL', () => {
		expect(() => createTranscribeModel('openaiCompatible', { apiKey: 'k' }, 'whisper')).toThrow('needs a base URL');
	});
});
