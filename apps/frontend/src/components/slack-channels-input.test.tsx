// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SlackChannelsInput } from './slack-channels-input';

afterEach(cleanup);

describe('SlackChannelsInput', () => {
	it('keeps an existing channel while typing a longer name that starts with it', () => {
		const changes = renderInput(['#sales']);

		typeDraft('#sales-eu');

		expect(changes.at(-1)).toEqual(['#sales', '#sales-eu']);
		expect(screen.getByRole('button', { name: 'Edit Slack channel #sales' })).toBeTruthy();
	});

	it('includes the channel being typed so saving mid-typing keeps it', () => {
		const changes = renderInput(['C0123456789']);

		typeDraft('#ops');

		expect(changes.at(-1)).toEqual(['C0123456789', '#ops']);
		expect(screen.queryByRole('button', { name: 'Edit Slack channel #ops' })).toBeNull();
	});

	it('turns comma-separated text into separate channels', () => {
		const changes = renderInput([]);

		fireEvent.change(getInput(), { target: { value: '#sales, C0123456789,' } });

		expect(changes.at(-1)).toEqual(['#sales', 'C0123456789']);
		expect(screen.getByRole('button', { name: 'Edit Slack channel #sales' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Edit Slack channel C0123456789' })).toBeTruthy();
	});

	it('commits the draft on blur', () => {
		renderInput([]);

		typeDraft('#ops');
		fireEvent.blur(getInput());

		expect(screen.getByRole('button', { name: 'Edit Slack channel #ops' })).toBeTruthy();
	});
});

function renderInput(initialChannels: string[]): string[][] {
	const changes: string[][] = [];

	function ControlledInput() {
		const [channels, setChannels] = useState(initialChannels);
		return (
			<SlackChannelsInput
				channels={channels}
				saveError={null}
				disabled={false}
				onChange={(nextChannels) => {
					changes.push(nextChannels);
					setChannels(nextChannels);
				}}
			/>
		);
	}

	render(<ControlledInput />);
	return changes;
}

function typeDraft(text: string) {
	for (let length = 1; length <= text.length; length++) {
		fireEvent.change(getInput(), { target: { value: text.slice(0, length) } });
	}
}

function getInput(): HTMLInputElement {
	return screen.getByRole('textbox', { name: 'Slack channels' });
}
