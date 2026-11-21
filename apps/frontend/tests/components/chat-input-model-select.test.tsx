// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { ChatInputModelSelect } from '@/components/chat-input-model-select';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	setSelectedModel: vi.fn(),
	setLocalAgentModel: vi.fn(),
	localAgent: { isAvailable: false, status: undefined as unknown, isPending: false },
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
		localAgentModel: null,
		setLocalAgentModel: mocks.setLocalAgentModel,
	}),
}));

vi.mock('@/hooks/use-local-agent-status', () => ({
	useLocalAgentStatus: () => mocks.localAgent,
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
	mocks.localAgent = { isAvailable: false, status: undefined, isPending: false };
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

	expect(
		screen.getAllByRole('option').map((option) => [option.textContent, option.getAttribute('aria-disabled')]),
	).toEqual([
		['AutoManaged', 'true'],
		['Managed', 'true'],
		['Configured', null],
		['Manage models', null],
	]);
	expect(screen.getAllByLabelText('Unavailable: nao credits exhausted')).toHaveLength(2);
});

it('lists the models of the local Claude Code in the desktop app, even with no nao model', () => {
	mocks.hasProject = true;
	mocks.localAgent = {
		isAvailable: true,
		isPending: false,
		status: {
			state: 'ready',
			version: '2.1.0',
			account: { subscriptionType: 'max' },
			models: [
				{ value: 'opus', displayName: 'Opus 5.5', description: '' },
				{ value: 'claude-opus-4-8', displayName: 'Opus 4.8', description: '' },
			],
		},
	};

	render(
		<TooltipProvider>
			<ChatInputModelSelect />
		</TooltipProvider>,
	);
	fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

	expect(screen.queryByText('Configure a model')).toBeNull();
	expect(screen.queryByRole('option', { name: /Opus 4\.8/ })).toBeNull();
	fireEvent.click(screen.getByRole('option', { name: /Opus 5\.5/ }));

	expect(mocks.setLocalAgentModel).toHaveBeenCalledWith({
		provider: 'claude',
		model: 'opus',
		displayName: 'Opus 5.5',
	});
});

it('tells the user to sign in to Claude Code when it is installed but signed out', () => {
	mocks.hasProject = true;
	mocks.localAgent = { isAvailable: true, isPending: false, status: { state: 'not-logged-in', version: '2.1.0' } };

	render(
		<TooltipProvider>
			<ChatInputModelSelect />
		</TooltipProvider>,
	);
	fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

	expect(
		screen.getByRole('option', { name: 'Run `claude` in a terminal to sign in' }).getAttribute('aria-disabled'),
	).toBe('true');
});
