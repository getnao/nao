// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModel, useModels } from './models';
import type { UseModelRequest } from './models';

const host = vi.hoisted(() => ({
	requestModel: vi.fn(),
	requestModels: vi.fn(),
}));

vi.mock('../story-host', () => host);

function Answer({ request, enabled }: { request: UseModelRequest; enabled?: boolean }) {
	const answer = useModel(request, { enabled });
	return <span data-testid='answer'>{answer.status === 'success' ? answer.data.text : answer.status}</span>;
}

function ModelNames() {
	const models = useModels();
	return <span data-testid='models'>{models.data?.map((model) => model.name).join(', ') ?? models.status}</span>;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('useModel', () => {
	it('sends an llm request and answers with its text', async () => {
		host.requestModel.mockResolvedValue({ kind: 'llm', model: 'openai:gpt', text: 'Revenue grew 12%.' });
		render(<Answer request={{ prompt: 'Summarize revenue', model: 'openai:gpt' }} />);

		await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('Revenue grew 12%.'));
		expect(host.requestModel).toHaveBeenCalledWith(
			{ kind: 'llm', prompt: 'Summarize revenue', model: 'openai:gpt' },
			{ fresh: false },
		);
	});

	it('asks nothing until enabled, nor for an empty prompt', () => {
		render(<Answer request={{ prompt: 'Summarize churn' }} enabled={false} />);
		render(<Answer request={{ prompt: '   ' }} />);

		expect(host.requestModel).not.toHaveBeenCalled();
	});

	it('answers every component asking the same thing with one call', async () => {
		host.requestModel.mockResolvedValue({ kind: 'llm', model: 'openai:gpt', text: 'Once.' });
		render(
			<>
				<Answer request={{ prompt: 'Asked twice' }} />
				<Answer request={{ prompt: 'Asked twice' }} />
			</>,
		);

		await waitFor(() =>
			expect(screen.getAllByTestId('answer').map((node) => node.textContent)).toEqual(['Once.', 'Once.']),
		);
		expect(host.requestModel).toHaveBeenCalledTimes(1);
	});
});

describe('useModels', () => {
	it('lists the models the host offers', async () => {
		host.requestModels.mockResolvedValue([
			{ kind: 'llm', id: 'openai:gpt', provider: 'openai', modelId: 'gpt', name: 'GPT', isDefault: true },
			{
				kind: 'llm',
				id: 'anthropic:claude',
				provider: 'anthropic',
				modelId: 'claude',
				name: 'Claude',
				isDefault: false,
			},
		]);
		render(<ModelNames />);

		await waitFor(() => expect(screen.getByTestId('models').textContent).toBe('GPT, Claude'));
	});
});
