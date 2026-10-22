// @vitest-environment jsdom

/**
 * A renderer that throws on an unvalidated input shape used to propagate to the route and replace
 * the whole page, and the persisted part made it repeat on every render.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallErrorBoundary } from './tool-call-error-boundary';

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('ToolCallErrorBoundary', () => {
	const Throwing = () => {
		throw new Error('options?.flatMap is not a function');
	};

	it('contains a renderer crash instead of letting it escape', () => {
		expect(() =>
			render(
				<ToolCallErrorBoundary toolName='clarification' resetKey='output-available'>
					<Throwing />
				</ToolCallErrorBoundary>,
			),
		).not.toThrow();
		expect(screen.getByText(/could not be displayed/)).toBeDefined();
	});

	it('retries the render when the call identity changes', () => {
		const { rerender } = render(
			<ToolCallErrorBoundary toolName='clarification' resetKey='call-a:output-available'>
				<Throwing />
			</ToolCallErrorBoundary>,
		);
		expect(screen.getByText(/could not be displayed/)).toBeDefined();

		rerender(
			<ToolCallErrorBoundary toolName='clarification' resetKey='call-b:output-available'>
				<p>a different call</p>
			</ToolCallErrorBoundary>,
		);

		expect(screen.getByText('a different call')).toBeDefined();
		expect(screen.queryByText(/could not be displayed/)).toBeNull();
	});

	it('renders its children when nothing throws', () => {
		render(
			<ToolCallErrorBoundary toolName='display_chart' resetKey='output-available'>
				<p>chart body</p>
			</ToolCallErrorBoundary>,
		);

		expect(screen.getByText('chart body')).toBeDefined();
		expect(screen.queryByText(/could not be displayed/)).toBeNull();
	});
});
