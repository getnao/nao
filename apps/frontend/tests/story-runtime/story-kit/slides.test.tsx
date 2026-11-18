// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import { highlightStoryElement } from '@/story-runtime/story-highlight';
import { Slide, Slides } from '@/story-runtime/story-kit/slides';

vi.mock('@/story-runtime/story-host', () => ({ isPrintMode: () => false }));
vi.mock('@/story-runtime/story-kit/hooks', () => ({ useStoryBrand: () => null }));

stubResizeObserver();

afterEach(cleanup);

describe('Slides', () => {
	it('turns to the slide holding a cited element without scrolling the frame', async () => {
		const scrollIntoView = stubScrollIntoView();
		render(
			<Slides>
				<Slide title='Overview'>
					<p>Revenue is up.</p>
				</Slide>
				<Slide title='Churn'>
					<p>Customers left in May.</p>
				</Slide>
			</Slides>,
		);
		await screen.findByText('Customers left in May.');
		expect(screen.getByText('1 / 2')).toBeTruthy();

		act(() => {
			highlightStoryElement({ block: { kind: 'text' }, text: 'Customers left in May.' });
		});

		expect(screen.getByText('2 / 2')).toBeTruthy();
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
