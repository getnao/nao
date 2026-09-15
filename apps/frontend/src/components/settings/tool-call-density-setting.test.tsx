// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ToolCallDensitySetting } from './tool-call-density-setting';

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeAll(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterAll(() => {
	vi.unstubAllGlobals();
});

afterEach(cleanup);

describe('ToolCallDensitySetting', () => {
	it('stays disabled while policy data is loading', () => {
		render(<ToolCallDensitySetting value='detailed' onValueChange={vi.fn()} canChange={false} isLoading />);

		expect(screen.getByText('Loading setting...')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Compact' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByRole('slider', { name: 'Tool call density' }).hasAttribute('data-disabled')).toBe(true);
	});

	it('shows the managed message and disables changes when locked', () => {
		const onValueChange = vi.fn();
		render(
			<ToolCallDensitySetting
				value='compact'
				onValueChange={onValueChange}
				canChange={false}
				isLoading={false}
			/>,
		);

		expect(screen.getByText('Managed by your user group.')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it('allows density changes when unlocked', () => {
		const onValueChange = vi.fn();
		render(<ToolCallDensitySetting value='compact' onValueChange={onValueChange} canChange isLoading={false} />);

		fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
		expect(onValueChange).toHaveBeenCalledWith('detailed');
	});
});
