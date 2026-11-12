// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmAccessModeControl } from './llm-access-mode-control';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	mutate: vi.fn(),
	navigate: vi.fn(),
	license: {
		data: { 'user-groups': true },
		isLoading: false,
	},
	readiness: {
		data: {
			mode: 'project' as 'project' | 'user_group',
			canEnable: true,
			staleConfigIds: [],
			unassignedGroupIds: ['group-1'],
			userIdsWithoutModels: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
			ignoredProviderIds: [],
			staleDefaultCount: 0,
			staleAutomationIds: [],
		},
		isLoading: false,
		isError: false,
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => mocks.readiness,
	useMutation: () => ({
		mutate: mocks.mutate,
		isPending: false,
		error: null,
	}),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => mocks.license,
}));
vi.mock('@/components/settings/upgrade-to-enterprise', () => ({
	UpgradeToEnterprise: () => <span>Upgrade to Enterprise</span>,
}));
vi.mock('@/main', () => ({
	trpc: {
		project: {
			getLlmAccessReadiness: { queryOptions: vi.fn(() => ({ queryKey: ['llm-access-readiness'] })) },
			listAvailableTranscribeModels: { queryOptions: vi.fn(() => ({ queryKey: ['transcribe-models'] })) },
			updateLlmAccessMode: { mutationOptions: vi.fn((options) => options) },
		},
	},
}));
vi.mock('@/components/ui/confirmation-dialog', () => ({
	ConfirmationDialog: ({
		open,
		title,
		description,
		confirmLabel,
		onConfirm,
	}: {
		open: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		onConfirm: () => void;
	}) =>
		open ? (
			<div role='dialog' aria-label={title}>
				<p>{description}</p>
				<button onClick={onConfirm}>{confirmLabel}</button>
			</div>
		) : null,
}));

describe('LlmAccessModeControl', () => {
	beforeEach(() => {
		mocks.readiness.data.canEnable = true;
		mocks.readiness.data.mode = 'project';
		mocks.license.data['user-groups'] = true;
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('does not warn about unassigned access while restrictions are disabled', () => {
		render(<LlmAccessModeControl />);

		expect(screen.getByRole('switch', { name: 'Restrict models by user group' }).getAttribute('aria-checked')).toBe(
			'false',
		);
		expect(screen.queryByText(/users have no assigned models/)).toBeNull();
		expect(screen.queryByText(/group has no available models/)).toBeNull();
	});

	it('shows the affected configuration in the activation confirmation', () => {
		render(<LlmAccessModeControl />);

		fireEvent.click(screen.getByRole('switch', { name: 'Restrict models by user group' }));

		expect(
			screen.getByText(
				'5 users have no assigned models; 1 group has no available models. Each user will only be able to run models assigned through their groups.',
			),
		).toBeDefined();
	});

	it('shows a blocking modal instead of an inline warning when no credential is assigned', () => {
		mocks.readiness.data.canEnable = false;
		render(<LlmAccessModeControl />);

		expect(screen.queryByText(/Assign at least one active LLM credential/)).toBeNull();
		fireEvent.click(screen.getByRole('switch', { name: 'Restrict models by user group' }));

		expect(screen.getByRole('dialog', { name: 'Set up LLM access first' })).toBeDefined();
		expect(screen.getByText(/Assign at least one active LLM credential/)).toBeDefined();
		fireEvent.click(screen.getByRole('button', { name: 'Go to Users & Groups' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups',
			search: { tab: 'groups' },
		});
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('allows disabling restrictions after the Enterprise license expires', () => {
		mocks.readiness.data.mode = 'user_group';
		mocks.license.data['user-groups'] = false;
		render(<LlmAccessModeControl />);

		const control = screen.getByRole('switch', { name: 'Restrict models by user group' });
		expect(control.hasAttribute('disabled')).toBe(false);
		fireEvent.click(control);
		expect(mocks.mutate).toHaveBeenCalledWith({ mode: 'project' });
	});
});
