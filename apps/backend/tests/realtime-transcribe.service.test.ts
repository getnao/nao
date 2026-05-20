import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as projectQueries from '../src/queries/project.queries';
import * as llmConfigQueries from '../src/queries/project-llm-config.queries';
import { createLiveTranscriptionSession } from '../src/services/realtime-transcribe.service';

vi.mock('../src/queries/project.queries');
vi.mock('../src/queries/project-llm-config.queries');

describe('createLiveTranscriptionSession', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(projectQueries.getAgentSettings).mockResolvedValue({
			transcribe: { enabled: true, provider: 'openai', modelId: 'gpt-4o-mini-transcribe' },
		});
		vi.mocked(llmConfigQueries.getProjectLlmConfigByProvider).mockResolvedValue({
			apiKey: 'test-key',
			baseUrl: null,
		} as never);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it('returns client secret from OpenAI transcription session', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				client_secret: { value: 'ek_test', expires_at: 1_700_000_000 },
			}),
		});

		const session = await createLiveTranscriptionSession('project-1');

		expect(session).toEqual({ clientSecret: 'ek_test', expiresAt: 1_700_000_000 });
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.openai.com/v1/realtime/transcription_sessions',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('throws when transcription is disabled', async () => {
		vi.mocked(projectQueries.getAgentSettings).mockResolvedValue({
			transcribe: { enabled: false },
		});

		await expect(createLiveTranscriptionSession('project-1')).rejects.toThrow('Voice input is not enabled');
	});
});
