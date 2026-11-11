// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { highlightStoryElement } from '../story-highlight';
import { Slide, Slides } from './slides';

vi.mock('../story-host', () => ({ isPrintMode: () => false }));
vi.mock('./hooks', () => ({ useStoryBrand: () => null }));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		disconnect() {}
	},
);

afterEach(cleanup);

describe('Slides', () => {
	it('turns to the slide holding a cited element without scrolling the frame', async () => {
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
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
