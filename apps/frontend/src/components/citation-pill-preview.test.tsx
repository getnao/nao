// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CitationPillPreview } from './citation-pill-preview';
import type { CitationData } from '@nao/shared/types';

const PASSAGE: CitationData = { start: 120, end: 180, text: 'Sales dropped after the price change' };

function Prompt({ onOpen }: { onOpen: (citation: CitationData) => void }) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div ref={containerRef}>
			<CitationPillPreview containerRef={containerRef} findCitation={() => PASSAGE} onOpen={onOpen} />
			<span data-mention-trigger='❝' data-mention-id='c1'>
				<span className='mention-pill-icon'>x</span>
				<span>“Sales dropped…”</span>
			</span>
		</div>
	);
}

describe('CitationPillPreview', () => {
	afterEach(cleanup);

	it('opens the citation from its label, and leaves the icon to deleting the pill', () => {
		const onOpen = vi.fn();
		render(<Prompt onOpen={onOpen} />);

		fireEvent.click(screen.getByText('x'));
		expect(onOpen).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText('“Sales dropped…”'));
		expect(onOpen).toHaveBeenCalledWith(PASSAGE);
	});
});
