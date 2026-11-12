// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPromptCard } from '@/components/agent-prompt-card';

const writeText = vi.fn();

beforeEach(() => {
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
});

afterEach(cleanup);

describe('AgentPromptCard', () => {
	it('formats the prompt and copies its complete source', () => {
		const prompt = 'ABOUT NAO\n\nFirst paragraph.\n\n1. Install the skill.\n\nnpx skills add getnao/nao';
		render(<AgentPromptCard prompt={prompt} />);

		expect(screen.getByText('ABOUT NAO').tagName).toBe('P');
		expect(screen.getByText('npx skills add getnao/nao').tagName).toBe('CODE');

		fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
		expect(writeText).toHaveBeenCalledWith(prompt);
	});
});
