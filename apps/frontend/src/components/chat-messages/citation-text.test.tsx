// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantTextWithCitation } from './citation-text';
import type { TrpcRouter } from '@nao/backend/trpc';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	copySupportRequest: vi.fn(),
	submitSupportRequest: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {},
	trpcClient: { support: { submit: { mutate: mocks.submitSupportRequest } } },
}));

vi.mock('@/hooks/use-attachment-download', () => ({
	useAttachmentDownload: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({
	useCopyToClipboard: () => ({ copy: mocks.copySupportRequest, isCopied: false }),
}));

const answer = (text: string, isStreaming = false) => (
	<TooltipProvider>
		<AssistantTextWithCitation text={text} isStreaming={isStreaming} />
	</TooltipProvider>
);

const renderAnswer = (text: string, isStreaming = false) => {
	return render(answer(text, isStreaming));
};

describe('AssistantTextWithCitation', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		mocks.copySupportRequest.mockReset();
		mocks.submitSupportRequest.mockReset();
	});

	it('suppresses a backticked saved file throughout streaming', () => {
		const stages = [
			'Le fichier est ici : `<saved-fi',
			'Le fichier est ici : `<saved-file path="/home/exports/report.md"',
			'Le fichier est ici : `<saved-file path="/home/exports/report.md">rep',
			'Le fichier est ici : `<saved-file path="/home/exports/report.md">report.md</saved-fi',
			'Le fichier est ici : `<saved-file path="/home/exports/report.md">report.md</saved-file>',
			'Le fichier est ici : `<saved-file path="/home/exports/report.md">report.md</saved-file>`',
		];
		const { container, rerender } = renderAnswer(stages[0], true);

		for (const stage of stages) {
			rerender(answer(stage, true));
			expect(screen.getByText('Le fichier est ici :')).toBeDefined();
			expect(container.textContent).not.toContain('saved-file');
			expect(container.textContent).not.toContain('report');
			expect(container.querySelector('code')).toBeNull();
		}
	});

	it('preserves ordinary inline code while streaming', () => {
		const { container } = renderAnswer('Run `npm run lint` before pushing.', true);

		expect(container.querySelector('code')?.textContent).toBe('npm run lint');
	});

	it('preserves a closed incomplete saved-file example while streaming', () => {
		const markup = '<saved-file path="/home/exports/report.md">';
		const { container } = renderAnswer(`The opening tag is \`${markup}\`.`, true);

		expect(container.querySelector('code')?.textContent).toBe(markup);
	});

	it('preserves saved-file examples in fenced and indented code while streaming', () => {
		const markup = '<saved-file path="/home/exports/report.md">report.md</saved-file>';
		const fenced = renderAnswer(`\`\`\`xml\n${markup}\n\`\`\``, true);
		expect(fenced.container.querySelector('code')?.textContent).toContain(markup);
		fenced.unmount();

		const indented = renderAnswer(`    ${markup}`, true);
		expect(indented.container.querySelector('code')?.textContent).toContain(markup);
	});

	it('preserves saved-file examples in container-prefixed fences', () => {
		const markup = '<saved-file path="/home/exports/report.md">report.md</saved-file>';
		const examples = [`> \`\`\`xml\n> ${markup}\n> \`\`\``, `- \`\`\`xml\n  ${markup}\n  \`\`\``];

		for (const isStreaming of [false, true]) {
			for (const example of examples) {
				const view = renderAnswer(example, isStreaming);
				expect(view.container.querySelector('code')?.textContent).toContain(markup);
				expect(screen.queryByLabelText('Download report.md')).toBeNull();
				view.unmount();
			}
		}
	});

	it('keeps raw saved-file and citation labels while streaming', () => {
		const { container } = renderAnswer(
			'Total: <citation-number id="query_a1b2" column="total">99</citation-number>. File: <saved-file path="/home/exports/report.md">report.md</saved-file>.',
			true,
		);

		expect(container.textContent).toContain('Total: 99. File: report.md.');
		expect(container.textContent).not.toContain('citation-number');
		expect(container.textContent).not.toContain('saved-file');
	});

	it('hides citation tags that start with an OpenAI citation marker while streaming', () => {
		const { container } = renderAnswer(
			'Up 822.7%. \uE200citation-number id="query_ce90" column="growth">822.7</citation-number> \uE200cite\uE202turn0\uE201',
			true,
		);

		expect(container.textContent?.trim()).toBe('Up 822.7%. 822.7');
	});

	it('turns a saved file into a chip that can be opened or downloaded', () => {
		renderAnswer(
			'Your export is ready: <saved-file path="/home/exports/churn-2025.csv">churn-2025.csv</saved-file>',
		);

		expect(screen.getByText('churn-2025.csv')).toBeDefined();
		expect(screen.getByLabelText('Download churn-2025.csv')).toBeDefined();
	});

	it('turns a backticked saved file into a chip that can be opened or downloaded', () => {
		renderAnswer('Le fichier est ici : `<saved-file path="/home/exports/report.md">report.md</saved-file>`');

		expect(screen.getByRole('button', { name: 'report.md' })).toBeDefined();
		expect(screen.getByLabelText('Download report.md')).toBeDefined();
	});

	it('turns backticked saved files with alternate attribute syntax into chips', () => {
		const examples = [
			"<saved-file path='/home/exports/report.md'>report.md</saved-file>",
			'<saved-file   path = "/home/exports/report.md" >report.md</saved-file>',
		];

		for (const markup of examples) {
			const view = renderAnswer(`File: \`${markup}\``);
			expect(screen.getByLabelText('Download report.md')).toBeDefined();
			view.unmount();
		}
	});

	it('preserves ordinary inline code', () => {
		const { container } = renderAnswer('Run `npm run lint` before pushing.');

		expect(container.querySelector('code')?.textContent).toBe('npm run lint');
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('opens an in-app dialog and sends a support request', async () => {
		mocks.submitSupportRequest.mockResolvedValue({ success: true });
		renderAnswer('[Contact support](mailto:support@getnao.io)');

		fireEvent.click(screen.getByRole('button', { name: 'Contact support' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Support request' }), {
			target: { value: 'Please help me connect my warehouse.' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		fireEvent.click(screen.getByRole('button', { name: 'Contact support' }));
		expect((screen.getByRole('textbox', { name: 'Support request' }) as HTMLTextAreaElement).value).toBe(
			'Please help me connect my warehouse.',
		);
		fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));

		await waitFor(() => {
			expect(mocks.submitSupportRequest).toHaveBeenCalledWith({
				request: 'Please help me connect my warehouse.',
			});
			expect(screen.getByRole('heading', { name: 'Request sent' })).toBeDefined();
		});
		fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		fireEvent.click(screen.getByRole('button', { name: 'Contact support' }));
		expect((screen.getByRole('textbox', { name: 'Support request' }) as HTMLTextAreaElement).value).toBe('');
	});

	it.each([false, true])('opens alternate support links in-app while streaming is %s', (isStreaming) => {
		renderAnswer('[Get help](<mailto:support@getnao.io>)', isStreaming);

		fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
		expect(screen.getByRole('textbox', { name: 'Support request' })).toBeDefined();
	});

	it.each([false, true])('preserves support links written as inline code while streaming is %s', (isStreaming) => {
		const markdown = '[Contact support](mailto:support@getnao.io)';
		const { container } = renderAnswer(`Use \`${markdown}\` in the message.`, isStreaming);

		expect(container.querySelector('code')?.textContent).toBe(markdown);
		expect(screen.queryByRole('button', { name: 'Contact support' })).toBeNull();
	});

	it('offers an email fallback when in-app support is unavailable', async () => {
		mocks.copySupportRequest.mockResolvedValue(undefined);
		mocks.submitSupportRequest.mockRejectedValue(
			TRPCClientError.from<TrpcRouter>({
				error: {
					code: -32012,
					message: 'In-app support is not available on this deployment.',
					data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
				},
			}),
		);
		renderAnswer('[Contact support](mailto:support@getnao.io)');

		fireEvent.click(screen.getByRole('button', { name: 'Contact support' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Support request' }), {
			target: { value: 'Please help me connect my warehouse.' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));

		expect((await screen.findByRole('alert')).textContent).toBe(
			'In-app support is not available on this deployment.',
		);
		fireEvent.click(screen.getByRole('button', { name: 'Copy request' }));
		expect(mocks.copySupportRequest).toHaveBeenCalledWith('Please help me connect my warehouse.');
		expect(screen.getByRole('link', { name: 'Open email app' }).getAttribute('href')).toBe(
			'mailto:support@getnao.io?subject=nao%20support%20request',
		);
	});

	it.each([
		['Read the docs', 'https://docs.getnao.io'],
		['Set up your project', '/onboarding'],
	])('keeps the %s message action as plain markdown', (label, href) => {
		renderAnswer(`[${label}](${href})`);

		expect(screen.getByRole('button', { name: label }).getAttribute('data-slot')).toBeNull();
	});

	it.each([false, true])('keeps Streamdown link safety while streaming is %s', async (isStreaming) => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		renderAnswer('[Read the docs](https://docs.getnao.io)', isStreaming);

		fireEvent.click(screen.getByRole('button', { name: 'Read the docs' }));
		expect(await screen.findByRole('heading', { name: 'Open external link?' })).toBeDefined();
		fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
		expect(open).toHaveBeenCalledWith('https://docs.getnao.io/', '_blank', 'noreferrer');
	});

	it('clarifies the legacy Jaffle Shop limit message and removes its onboarding action', () => {
		renderAnswer(
			'You’ve finished the Jaffle Shop preview. [Set up your own project](/onboarding) to keep chatting. This conversation is saved.',
		);

		expect(
			screen.getByText(
				'You’ve used all the requests available for this example project. Let’s set up your own project and chat with your own data!',
			),
		).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Set up your own project' })).toBeNull();
	});

	it('keeps the legacy guided setup message above its support action', () => {
		const { container } = renderAnswer(
			'You’ve reached the chat limit for guided setup. Your progress is safe, and the setup actions on this page still work. [Contact support](mailto:support@getnao.io) if you need help debugging your setup.',
		);

		expect(container.textContent).toContain(
			'You’ve reached the chat limit for guided setup. Your progress is safe. If you need help completing setup.',
		);
		expect(container.textContent?.trim().endsWith('Contact support')).toBe(true);
	});

	it('does not turn a saved-file example in a fenced code block into a chip', () => {
		const markup = '<saved-file path="/home/exports/report.md">report.md</saved-file>';
		const { container } = renderAnswer(`\`\`\`xml\n${markup}\n\`\`\``);

		expect(container.querySelector('code')?.textContent).toContain(markup);
		expect(screen.queryByLabelText('Download report.md')).toBeNull();
	});

	it('does not turn malformed backticked markup into a chip', () => {
		const markup = '<saved-file path="/home/exports/report.md">report.md';
		const { container } = renderAnswer(`The example is \`${markup}\``);

		expect(container.querySelector('code')?.textContent).toBe(markup);
		expect(screen.queryByLabelText('Download report.md')).toBeNull();
	});

	it('leaves a file outside permanent storage as text', () => {
		renderAnswer('Look at <saved-file path="/etc/passwd">secrets</saved-file>');

		expect(screen.getByText('Look at secrets')).toBeDefined();
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('leaves a backticked file outside permanent storage as text', () => {
		renderAnswer('Look at `<saved-file path="/etc/passwd">secrets</saved-file>`');

		expect(screen.getByText('Look at secrets')).toBeDefined();
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.queryByText(/saved-file/)).toBeNull();
	});
});
