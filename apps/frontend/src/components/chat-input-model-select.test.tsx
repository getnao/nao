// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ChatInputModelSelect } from './chat-input-model-select';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	setSelectedModel: vi.fn(),
	hasProject: false,
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: ReactNode }) => <>{children}</>,
	useNavigate: () => vi.fn(),
}));

vi.mock('@/components/ui/llm-provider-icon', () => ({
	LlmProviderIcon: ({ provider }: { provider: string }) => <span aria-label={`${provider} model`} />,
}));

vi.mock('@/hooks/use-model-selection', () => ({
	isSameModel: () => false,
	useModelSelection: () => ({
		availableModels: [],
		defaultModel: null,
		selectedModel: null,
		usesDefaultModel: true,
		setSelectedModel: mocks.setSelectedModel,
		isPending: false,
		canCycleModels: false,
		hasProject: mocks.hasProject,
	}),
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ isAdmin: true }),
}));

afterEach(() => {
	cleanup();
	mocks.hasProject = false;
});

it('shows the example model instead of setup for a project-less user', () => {
	render(<ChatInputModelSelect />);

	expect(screen.getByLabelText('nao model')).toBeTruthy();
	expect(screen.queryByText('Auto')).toBeNull();
	expect(screen.getByText('GPT 6 Sol')).toBeTruthy();
	expect(screen.queryByText('Configure a model')).toBeNull();

	fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model' }), { key: 'Enter' });

	expect(
		screen.getByRole('option', { name: 'Set up a project to switch models' }).getAttribute('aria-disabled'),
	).toBe('true');
});

it('shows the example model for an example chat when the user has a project', () => {
	mocks.hasProject = true;

	render(<ChatInputModelSelect isExample />);

	expect(screen.getByText('GPT 6 Sol')).toBeTruthy();
	expect(screen.queryByText('Configure a model')).toBeNull();
});
