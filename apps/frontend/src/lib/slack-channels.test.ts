import { describe, expect, it } from 'vitest';

import {
	formatSlackChannels,
	getInvalidSlackChannels,
	getSlackChannelError,
	getSlackChannelsSaveError,
	mergeSlackChannels,
	parseSlackChannels,
} from './slack-channels';

describe('parseSlackChannels', () => {
	it('splits on commas, semicolons and new lines and trims each channel', () => {
		expect(parseSlackChannels(' C04RVN7XK2P,#sales ;\n#data-alerts ')).toEqual([
			'C04RVN7XK2P',
			'#sales',
			'#data-alerts',
		]);
	});

	it('drops empty entries and duplicates', () => {
		expect(parseSlackChannels('#sales,, #sales ,')).toEqual(['#sales']);
	});

	it('round-trips through the stored comma-separated value', () => {
		const channels = ['C04RVN7XK2P', '#sales'];
		expect(parseSlackChannels(formatSlackChannels(channels))).toEqual(channels);
	});
});

describe('mergeSlackChannels', () => {
	it('appends new channels without duplicating existing ones', () => {
		expect(mergeSlackChannels(['#sales'], ['#sales', '#ops'])).toEqual(['#sales', '#ops']);
	});
});

describe('getSlackChannelError', () => {
	it.each(['C04RVN7XK2P', 'G0123456789', 'D012345678', '#sales', '#data_alerts-eu'])('accepts %s', (channel) => {
		expect(getSlackChannelError(channel)).toBeNull();
	});

	it('explains why a channel is malformed', () => {
		expect(getSlackChannelError('#sales team')).toBe('Channel names cannot contain spaces.');
		expect(getSlackChannelError('#Sales')).toBe('Channel names use lowercase letters, numbers, - and _ only.');
		expect(getSlackChannelError('C123')).toBe(
			'Channel IDs are 9 to 12 uppercase letters or digits, like C0123456789.',
		);
		expect(getSlackChannelError('general')).toBe('Add # before channel names, like #general.');
		expect(getSlackChannelError('sales@team')).toBe('Use a channel ID or a name: C0123456789 or #channel-name.');
	});
});

describe('getSlackChannelsSaveError', () => {
	it('allows saving when every channel is valid', () => {
		expect(getSlackChannelsSaveError(['C04RVN7XK2P', '#sales'])).toBeNull();
		expect(getSlackChannelsSaveError([])).toBeNull();
	});

	it('counts malformed channels', () => {
		const channels = ['#sales', 'C123', '#sales team'];
		expect(getInvalidSlackChannels(channels)).toEqual(['C123', '#sales team']);
		expect(getSlackChannelsSaveError(channels)).toBe('Fix or remove 2 malformed Slack channels before saving.');
	});
});
