// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WarehouseProvisioningWarnings } from './onboarding-progress';

vi.mock('@/main', () => ({ trpc: {} }));

afterEach(cleanup);

describe('WarehouseProvisioningWarnings', () => {
	it('shows optional source failures without presenting setup as failed', () => {
		render(
			<WarehouseProvisioningWarnings
				warnings={[
					{
						source: 'confluence',
						message: 'Confluence could not be synced. Warehouse setup continued without it.',
					},
				]}
			/>,
		);

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Some optional business context was not synced')).toBeTruthy();
		expect(screen.getByText('Confluence could not be synced. Warehouse setup continued without it.')).toBeTruthy();
		expect(screen.queryByText(/warehouse setup failed/i)).toBeNull();
	});

	it('renders nothing when every source synced', () => {
		const view = render(<WarehouseProvisioningWarnings warnings={[]} />);
		expect(view.container.innerHTML).toBe('');
	});
});
