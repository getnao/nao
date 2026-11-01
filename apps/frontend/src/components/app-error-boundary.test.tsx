// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './app-error-boundary';

const firefoxStack = 'TRPCClientError2@http://localhost:3000/chunk.js:1861:5';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	Reflect.deleteProperty(document, 'execCommand');
});

it('shows the error page and reports the error when a child fails to render', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
	const slackActions: string[] = [];
	const writeText = vi.fn().mockImplementation(() => {
		slackActions.push('copy');
		return Promise.resolve();
	});
	const replace = vi.fn();
	vi.spyOn(window, 'open').mockImplementation(() => {
		slackActions.push('open');
		return {
			close: vi.fn(),
			location: { replace },
			opener: window,
		} as unknown as Window;
	});
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});

	render(
		<AppErrorBoundary>
			<BrokenComponent />
		</AppErrorBoundary>,
	);

	expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Send an error report on our server' }));
	expect(await screen.findByRole('button', { name: 'Error report sent' })).toBeTruthy();
	expect(fetchMock).toHaveBeenCalledWith(
		'/api/error-reports',
		expect.objectContaining({
			method: 'POST',
			headers: { 'content-type': 'application/json' },
		}),
	);
	const sentReport = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
		message: string;
		stack: string;
		pageUrl: string;
	};
	expect(sentReport).toEqual({
		message: 'TRPCClientError: Render failed',
		stack: expect.stringContaining(firefoxStack),
		pageUrl: `${window.location.origin}${window.location.pathname}`,
	});
	expect(sentReport.stack).toContain('React component stack:');
	expect(sentReport.stack).toContain('BrokenComponent');

	fireEvent.click(screen.getByRole('button', { name: 'Copy error details and open Slack' }));
	expect(writeText).toHaveBeenCalledWith(
		expect.stringMatching(
			new RegExp(
				[
					'^Nao error report',
					'',
					'Error: TRPCClientError: Render failed',
					`Page: ${window.location.origin}${window.location.pathname}`,
					'Occurred: .+',
					'',
					'Technical details:',
					firefoxStack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
				].join('\\n'),
			),
		),
	);
	expect(writeText).toHaveBeenCalledWith(expect.stringContaining('React component stack:'));
	expect(writeText).toHaveBeenCalledWith(expect.stringContaining('BrokenComponent'));
	expect(slackActions).toEqual(['copy', 'open']);
	await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('join.slack.com')));
	expect(screen.getByRole('button', { name: 'Copy error details and open Slack' })).toBeTruthy();
});

it('shows the error page when a child throws a falsy value', () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	render(
		<AppErrorBoundary>
			<NullThrowingComponent />
		</AppErrorBoundary>,
	);

	expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
});

it('shows manual error details when copying for Slack fails', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const close = vi.fn();
	vi.spyOn(window, 'open').mockReturnValue({
		close,
		location: { replace: vi.fn() },
		opener: window,
	} as unknown as Window);
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable')) },
	});
	Object.defineProperty(document, 'execCommand', {
		configurable: true,
		value: vi.fn().mockReturnValue(false),
	});

	render(
		<AppErrorBoundary>
			<BrokenComponent />
		</AppErrorBoundary>,
	);

	fireEvent.click(screen.getByRole('button', { name: 'Copy error details and open Slack' }));

	expect(await screen.findByText(/Couldn't copy automatically/)).toBeTruthy();
	expect(screen.getByText(new RegExp(firefoxStack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
	expect(screen.getByRole('link', { name: 'Open Slack anyway' }).getAttribute('href')).toContain('join.slack.com');
	expect(close).toHaveBeenCalled();
});

function BrokenComponent(): never {
	const error = new Error('Render failed');
	error.name = 'TRPCClientError';
	error.stack = firefoxStack;
	throw error;
}

function NullThrowingComponent(): never {
	throw null;
}
