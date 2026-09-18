// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganizationHeading } from './organization-heading';

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
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
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

		fireEvent.click(screen.getByRole('button', { name: /Switch organization/ }));
		const [currentOrganization] = await screen.findAllByRole('option');
		fireEvent.click(currentOrganization);

		expect(localStorage.getItem('nao.active-organization-id')).toBe('"current"');
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		expect(mocks.invalidateRouter).not.toHaveBeenCalled();
	});
});
