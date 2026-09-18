// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantTextWithCitation } from './citation-text';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/main', () => ({ trpc: {} }));

vi.mock('@/hooks/use-attachment-download', () => ({
	useAttachmentDownload: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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
	afterEach(cleanup);

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

	it('preserves saved-file examples in fenced and indented code while streaming', () => {
		const markup = '<saved-file path="/home/exports/report.md">report.md</saved-file>';
		const fenced = renderAnswer(`\`\`\`xml\n${markup}\n\`\`\``, true);
		expect(fenced.container.querySelector('code')?.textContent).toContain(markup);
		fenced.unmount();

		const indented = renderAnswer(`    ${markup}`, true);
		expect(indented.container.querySelector('code')?.textContent).toContain(markup);
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

	it('preserves ordinary inline code', () => {
		const { container } = renderAnswer('Run `npm run lint` before pushing.');

		expect(container.querySelector('code')?.textContent).toBe('npm run lint');
		expect(screen.queryByRole('button')).toBeNull();
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
