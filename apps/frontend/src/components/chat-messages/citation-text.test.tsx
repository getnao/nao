// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantTextWithCitation } from './citation-text';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/main', () => ({ trpc: {} }));

vi.mock('@/hooks/use-attachment-download', () => ({
	useAttachmentDownload: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const renderAnswer = (text: string) => {
	return render(
		<TooltipProvider>
			<AssistantTextWithCitation text={text} isStreaming={false} />
		</TooltipProvider>,
	);
};

describe('AssistantTextWithCitation', () => {
	afterEach(cleanup);

	it('turns a saved file into a chip that can be opened or downloaded', () => {
		renderAnswer(
			'Your export is ready: <saved-file path="/home/exports/churn-2025.csv">churn-2025.csv</saved-file>',
		);

		expect(screen.getByText('churn-2025.csv')).toBeDefined();
		expect(screen.getByLabelText('Download churn-2025.csv')).toBeDefined();
	});

	it('leaves a file outside permanent storage as text', () => {
		renderAnswer('Look at <saved-file path="/etc/passwd">secrets</saved-file>');

		expect(screen.getByText('Look at secrets')).toBeDefined();
		expect(screen.queryByRole('button')).toBeNull();
	});
});
