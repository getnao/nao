// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';
import { SettingsSqlQueryTag } from '@/components/settings/sql-query-tag';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	getAgentSettings: vi.fn(),
	getSqlQueryTagSettings: vi.fn(),
	updateAgentSettings: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getAgentSettings: {
				queryOptions: () => ({ queryKey: ['agent-settings'], queryFn: mocks.getAgentSettings }),
			},
			getSqlQueryTagSettings: {
				queryOptions: () => ({ queryKey: ['sql-query-tag-settings'], queryFn: mocks.getSqlQueryTagSettings }),
			},
			updateAgentSettings: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.updateAgentSettings, ...options }),
			},
		},
	},
}));

const PREVIEW_VARIABLES = {
	user_id: 'user-1',
	user_email: 'ada@example.com',
	user_groups: 'finance',
	project_id: 'project-1',
	chat_id: 'chat-1',
	source: 'web',
	database_id: 'warehouse',
};

describe('SettingsSqlQueryTag', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAgentSettings.mockResolvedValue({});
		mocks.getSqlQueryTagSettings.mockResolvedValue({ configFile: null, previewVariables: PREVIEW_VARIABLES });
		mocks.updateAgentSettings.mockResolvedValue({});
	});

	afterEach(cleanup);

	it('previews the comment being written with the values of the admin, and saves it', async () => {
		renderCard();
		const template = await screen.findByLabelText('Comment');
		await waitFor(() => expect(template.hasAttribute('disabled')).toBe(false));

		fireEvent.change(template, { target: { value: 'by {{ user_email }} from {{ source }}' } });
		fireEvent.click(screen.getByRole('switch', { name: 'Tag SQL queries' }));

		expect(screen.getByText('/* by ada@example.com from web */')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(mocks.updateAgentSettings).toHaveBeenCalled());
		expect(mocks.updateAgentSettings.mock.calls[0][0]).toEqual({
			sql: { queryTag: { enabled: true, template: 'by {{ user_email }} from {{ source }}', position: 'start' } },
		});
	});

	it('shows the tag of nao_config.yaml without letting the admin change it', async () => {
		mocks.getAgentSettings.mockResolvedValue({
			sql: { queryTag: { enabled: false, template: 'from the settings', position: 'start' } },
		});
		mocks.getSqlQueryTagSettings.mockResolvedValue({
			configFile: { template: 'yaml {{ user_groups }}', position: 'end' },
			previewVariables: PREVIEW_VARIABLES,
		});

		renderCard();

		expect(await screen.findByText('/* yaml finance */')).toBeTruthy();
		expect(screen.getByText('Set in nao_config.yaml')).toBeTruthy();
		expect(screen.getByLabelText('Comment').hasAttribute('disabled')).toBe(true);
		const enabledSwitch = screen.getByRole('switch', { name: 'Tag SQL queries' });
		expect(enabledSwitch.getAttribute('aria-checked')).toBe('true');
		expect(enabledSwitch.hasAttribute('disabled')).toBe(true);
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});
});

function renderCard() {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<TooltipProvider>
				<SettingsSqlQueryTag />
			</TooltipProvider>
		</QueryClientProvider>,
	);
}
