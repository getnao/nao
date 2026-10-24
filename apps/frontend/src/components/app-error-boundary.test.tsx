// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './app-error-boundary';

afterEach(() => {
	vi.restoreAllMocks();
});

it('shows the error page when a child fails to render', () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	render(
		<AppErrorBoundary>
			<BrokenComponent />
		</AppErrorBoundary>,
	);

	expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
});

function BrokenComponent(): never {
	throw new Error('Render failed');
}
