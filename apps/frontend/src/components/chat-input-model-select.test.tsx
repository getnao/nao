// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ChatInputModelSelect } from './chat-input-model-select';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	setSelectedModel: vi.fn(),
	cycleModel: vi.fn(),
	availableModels: [] as {
		provider: 'nao' | 'openai';
		modelId: string;
		name: string;
		baseUrl: null;
	}[],
	selectedModel: null as { provider: 'nao' | 'openai'; modelId: string } | null,
	defaultModel: null as { provider: 'nao' | 'openai'; modelId: string } | null,
	usesDefaultModel: true,
	canCycleModels: false,
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
		availableModels: mocks.availableModels,
		defaultModel: mocks.defaultModel,
		selectedModel: mocks.selectedModel,
		usesDefaultModel: mocks.usesDefaultModel,
		setSelectedModel: mocks.setSelectedModel,
		isPending: false,
		canCycleModels: mocks.canCycleModels,
		cycleModel: mocks.cycleModel,
		hasProject: mocks.hasProject,
	}),
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ isAdmin: true }),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.availableModels = [];
	mocks.selectedModel = null;
	mocks.defaultModel = null;
	mocks.usesDefaultModel = true;
	mocks.canCycleModels = false;
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

it('cycles models from the focused model selector', () => {
	mocks.availableModels = [
		{ provider: 'nao', modelId: 'managed', name: 'Managed', baseUrl: null },
		{ provider: 'openai', modelId: 'configured', name: 'Configured', baseUrl: null },
	];
	mocks.selectedModel = mocks.availableModels[0];
	mocks.usesDefaultModel = false;
	mocks.canCycleModels = true;

	render(
		<TooltipProvider>
			<ChatInputModelSelect />
		</TooltipProvider>,
	);

	fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab', shiftKey: true });

	expect(mocks.cycleModel).toHaveBeenCalledOnce();
});

it('locks nao models when managed credits are exhausted', () => {
	mocks.availableModels = [
		{ provider: 'nao', modelId: 'managed', name: 'Managed', baseUrl: null },
		{ provider: 'openai', modelId: 'configured', name: 'Configured', baseUrl: null },
	];
	mocks.selectedModel = mocks.availableModels[0];
	mocks.defaultModel = mocks.availableModels[0];
	mocks.usesDefaultModel = false;
	mocks.canCycleModels = true;

	render(
		<TooltipProvider>
			<ChatInputModelSelect managedCreditsExhausted />
		</TooltipProvider>,
	);
	const modelSelector = screen.getByRole('combobox');
	fireEvent.keyDown(modelSelector, { key: 'Tab', shiftKey: true });

	expect(mocks.setSelectedModel).toHaveBeenCalledWith(mocks.availableModels[1]);
	expect(mocks.cycleModel).not.toHaveBeenCalled();

	fireEvent.keyDown(modelSelector, { key: 'Enter' });

	expect(screen.getByRole('option', { name: /Auto/ }).getAttribute('aria-disabled')).toBe('true');
	expect(screen.getByRole('option', { name: /Managed/ }).getAttribute('aria-disabled')).toBe('true');
	expect(screen.getByRole('option', { name: /Configured/ }).getAttribute('aria-disabled')).toBeNull();
	expect(screen.getAllByLabelText('Unavailable: nao credits exhausted')).toHaveLength(2);
});
