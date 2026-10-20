// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WarehouseCommandProgress } from '@/components/onboarding-progress';

vi.mock('@/main', () => ({ trpc: {} }));

afterEach(cleanup);

describe('WarehouseCommandProgress', () => {
	it('shows live sync status, progress, and logs', () => {
		render(<WarehouseCommandProgress status='syncing' logs={'Syncing tables 42%\norders complete'} />);

		const progress = screen.getByRole('progressbar', { name: 'Syncing schema and previews' });
		expect(progress.getAttribute('aria-valuenow')).toBe('42');
		expect(screen.getByText('42%')).toBeTruthy();
		expect(screen.getByText('View nao sync logs')).toBeTruthy();
		expect(screen.getByText(/orders complete/)).toBeTruthy();
	});

	it('shows an in-progress connection check without a fake percentage', () => {
		render(<WarehouseCommandProgress status='debugging' logs='Testing postgres...' />);

		const progress = screen.getByRole('progressbar', { name: 'Checking your warehouse connection' });
		expect(progress.getAttribute('aria-valuenow')).toBeNull();
		expect(screen.getByText('In progress')).toBeTruthy();
		expect(screen.getByText('View nao debug logs')).toBeTruthy();
	});
});
