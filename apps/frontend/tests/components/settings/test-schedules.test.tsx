// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import { createTestQueryClient } from '../../helpers/query-client';
import type { ReactElement } from 'react';
import type { TestDefinition } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { ActiveScheduleCount, TestSchedules } from '@/components/settings/test-schedules';

const mocks = vi.hoisted(() => ({
	listSchedules: vi.fn(),
	createSchedule: vi.fn(),
	updateSchedule: vi.fn(),
	setScheduleEnabled: vi.fn(),
	deleteSchedule: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			listSchedules: {
				queryOptions: () => ({ queryKey: ['test-schedules'], queryFn: mocks.listSchedules }),
				queryKey: () => ['test-schedules'],
			},
			createSchedule: { mutationOptions: mutationOptions(mocks.createSchedule) },
			updateSchedule: { mutationOptions: mutationOptions(mocks.updateSchedule) },
			setScheduleEnabled: { mutationOptions: mutationOptions(mocks.setScheduleEnabled) },
			deleteSchedule: { mutationOptions: mutationOptions(mocks.deleteSchedule) },
		},
	},
}));

const SONNET = { provider: 'anthropic', modelId: 'claude-sonnet-5' };
const SETTINGS = { models: [SONNET], attempts: 2 } as TestRunSettings;
const TESTS = [
	{ path: 'revenue.yml', tags: ['finance', 'smoke'] },
	{ path: 'churn.yml', tags: ['smoke'] },
	{ path: 'orders.yml', tags: [] },
] as TestDefinition[];
const APP_SCHEDULE = {
	id: 'schedule-1',
	source: 'app',
	cron: '30 8 * * 3',
	isEnabled: true,
	tags: ['smoke'],
	models: [SONNET],
	attempts: 2,
	nextRunAt: new Date(2026, 10, 25, 8, 30),
};
const CONFIG_SCHEDULE = {
	id: 'config-0123456789abcdef',
	source: 'config',
	cron: '0 2 1 * *',
	isEnabled: true,
	tags: [],
	models: null,
	attempts: null,
	nextRunAt: new Date(2026, 11, 1, 2, 0),
};

describe('TestSchedules', () => {
	beforeEach(() => {
		stubResizeObserver();
		stubScrollIntoView();
		vi.clearAllMocks();
		mocks.listSchedules.mockResolvedValue({ schedules: [], timezone: 'UTC' });
		mocks.createSchedule.mockResolvedValue(undefined);
		mocks.updateSchedule.mockResolvedValue(undefined);
		mocks.setScheduleEnabled.mockResolvedValue(undefined);
		mocks.deleteSchedule.mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('adds a schedule at the picked time for the picked tags, with the models of the picker', async () => {
		renderWithQueryClient(<TestSchedules settings={SETTINGS} tests={TESTS} />);

		expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /^Schedules/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
		const form = within(screen.getByRole('form', { name: 'New schedule' }));
		expect(form.getByText('All 3 tests on claude-sonnet-5 · ×2')).toBeTruthy();
		expect(await form.findByText('UTC')).toBeTruthy();
		fireEvent.change(form.getByLabelText('Time'), { target: { value: '18:45' } });
		fireEvent.click(form.getByRole('button', { name: 'smoke' }));
		expect(form.getByText('2 tests on claude-sonnet-5 · ×2')).toBeTruthy();
		fireEvent.click(form.getByRole('button', { name: 'Add schedule' }));

		await waitFor(() =>
			expect(mocks.createSchedule.mock.calls[0][0]).toEqual({
				cron: '45 18 * * *',
				tags: ['smoke'],
				models: [SONNET],
				attempts: 2,
			}),
		);
		await waitFor(() => expect(screen.queryByRole('form', { name: 'New schedule' })).toBeNull());
	});

	it('pauses and removes a schedule of the app, and only lists the ones of nao_config.yaml', async () => {
		mocks.listSchedules.mockResolvedValue({ schedules: [APP_SCHEDULE, CONFIG_SCHEDULE], timezone: 'UTC' });
		renderWithQueryClient(<TestSchedules settings={SETTINGS} tests={TESTS} />);

		fireEvent.click(await screen.findByRole('button', { name: /^Schedules\s*2 active$/ }));
		const [appRow, configRow] = await screen.findAllByRole('listitem');
		expect(within(appRow).getByText('Every Wednesday at 08:30')).toBeTruthy();
		expect(within(appRow).getByText(/^smoke · claude-sonnet-5 · ×2 · next /)).toBeTruthy();
		expect(within(configRow).getByText('0 2 1 * *')).toBeTruthy();
		expect(within(configRow).getByText(/^All tests · the project models · next /)).toBeTruthy();
		expect(within(configRow).getByText('nao_config.yaml')).toBeTruthy();
		expect(within(configRow).queryByRole('button')).toBeNull();

		fireEvent.click(within(appRow).getByRole('switch'));
		await waitFor(() =>
			expect(mocks.setScheduleEnabled.mock.calls[0][0]).toEqual({ id: 'schedule-1', isEnabled: false }),
		);
		fireEvent.click(within(appRow).getByRole('button', { name: 'Remove the schedule Every Wednesday at 08:30' }));
		await waitFor(() => expect(mocks.deleteSchedule.mock.calls[0][0]).toEqual({ id: 'schedule-1' }));
	});

	it('edits a schedule in place, which keeps its models until the ones of the picker are taken', async () => {
		const haiku = { provider: 'anthropic', modelId: 'claude-haiku-5' };
		mocks.listSchedules.mockResolvedValue({
			schedules: [{ ...APP_SCHEDULE, models: [haiku], attempts: 1 }],
			timezone: 'UTC',
		});
		renderWithQueryClient(<TestSchedules settings={SETTINGS} tests={TESTS} />);

		fireEvent.click(screen.getByRole('button', { name: /^Schedules/ }));
		fireEvent.click(await screen.findByRole('button', { name: 'Edit the schedule Every Wednesday at 08:30' }));
		const form = within(screen.getByRole('form', { name: 'Edit the schedule' }));
		expect((form.getByLabelText('Time') as HTMLInputElement).value).toBe('08:30');
		expect(form.getByRole('button', { name: 'smoke' }).getAttribute('aria-pressed')).toBe('true');
		expect(form.getByText('2 tests on claude-haiku-5')).toBeTruthy();

		fireEvent.change(form.getByLabelText('Time'), { target: { value: '09:00' } });
		fireEvent.click(form.getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(mocks.updateSchedule.mock.calls[0][0]).toEqual({
				id: 'schedule-1',
				cron: '0 9 * * 3',
				tags: ['smoke'],
				models: [haiku],
				attempts: 1,
			}),
		);

		fireEvent.click(await screen.findByRole('button', { name: 'Edit the schedule Every Wednesday at 08:30' }));
		fireEvent.click(screen.getByRole('button', { name: 'Use the models of the picker: claude-sonnet-5 · ×2' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(mocks.updateSchedule.mock.calls[1][0]).toMatchObject({ models: [SONNET], attempts: 2 }),
		);
	});

	it('stays open once opened, until folded again', () => {
		const { unmount } = renderWithQueryClient(<TestSchedules settings={SETTINGS} tests={TESTS} />);
		fireEvent.click(screen.getByRole('button', { name: /^Schedules/ }));
		unmount();

		renderWithQueryClient(<TestSchedules settings={SETTINGS} tests={TESTS} />);
		expect(screen.getByRole('button', { name: 'Schedule' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: /^Schedules/ }));
		expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
	});

	it('counts the schedules that run, not the paused ones', async () => {
		mocks.listSchedules.mockResolvedValue({
			schedules: [APP_SCHEDULE, CONFIG_SCHEDULE, { ...APP_SCHEDULE, id: 'schedule-2', isEnabled: false }],
			timezone: 'UTC',
		});
		renderWithQueryClient(<ActiveScheduleCount />);

		expect((await screen.findByTitle('2 schedules run the tests')).textContent).toBe('2');
	});
});

function mutationOptions(mutationFn: (input: unknown) => unknown) {
	return (options: object) => ({ mutationFn, ...options });
}

function renderWithQueryClient(element: ReactElement) {
	return render(<QueryClientProvider client={createTestQueryClient()}>{element}</QueryClientProvider>);
}
