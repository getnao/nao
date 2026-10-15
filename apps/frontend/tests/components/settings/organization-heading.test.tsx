// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubLocalStorage, stubResizeObserver } from '../../helpers/browser-stubs';
import { OrganizationHeading } from '@/components/settings/organization-heading';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	invalidateRouter: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@tanstack/react-router', () => ({
	useRouter: () => ({ invalidate: mocks.invalidateRouter }),
}));

vi.mock('@/components/settings/editable-organization-name', () => ({
	EditableOrganizationName: ({ children }: { children: React.ReactNode }) => children,
}));

describe('OrganizationHeading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubLocalStorage();
		stubResizeObserver();
		Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
	});

	it('persists the displayed organization without invalidating it', async () => {
		renderHeading();

		openOrganizationSwitcher();
		const [currentOrganization] = await screen.findAllByRole('option');
		fireEvent.click(currentOrganization);

		expect(localStorage.getItem('nao.active-organization-id')).toBe('"current"');
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		expect(mocks.invalidateRouter).not.toHaveBeenCalled();
	});

	it('persists and invalidates after switching organizations', async () => {
		renderHeading();

		openOrganizationSwitcher();
		fireEvent.click(await screen.findByRole('option', { name: /Other/ }));

		await waitFor(() => {
			expect(localStorage.getItem('nao.active-organization-id')).toBe('"other"');
			expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
			expect(mocks.invalidateRouter).toHaveBeenCalledTimes(1);
		});
	});
});

function renderHeading() {
	render(
		<OrganizationHeading
			organization={{ id: 'current', name: 'Current', role: 'admin' }}
			organizations={[
				{ id: 'current', name: 'Current', role: 'admin' },
				{ id: 'other', name: 'Other', role: 'user' },
			]}
			canEdit={false}
		/>,
	);
}

function openOrganizationSwitcher() {
	fireEvent.click(screen.getByRole('button', { name: /Switch organization/ }));
}
