const CHANNEL_SEPARATOR_PATTERN = /[,;\n]/;
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]{8,11}$/;
const CHANNEL_NAME_PATTERN = /^#[a-z0-9][a-z0-9_-]{0,79}$/;

export const SLACK_CHANNEL_EXAMPLE = 'C0123456789 or #channel-name';

export function parseSlackChannels(text: string): string[] {
	const channels = text
		.split(CHANNEL_SEPARATOR_PATTERN)
		.map((channel) => channel.trim())
		.filter(Boolean);
	return [...new Set(channels)];
}

export function formatSlackChannels(channels: string[]): string {
	return channels.join(', ');
}

export function mergeSlackChannels(channels: string[], additions: string[]): string[] {
	return [...new Set([...channels, ...additions])];
}

export function hasSlackChannelSeparator(text: string): boolean {
	return CHANNEL_SEPARATOR_PATTERN.test(text);
}

/** Slack accepts public channel names (`#sales`) or conversation IDs (`C…` public, `G…` private, `D…` DM). */
export function getSlackChannelError(channel: string): string | null {
	if (CHANNEL_ID_PATTERN.test(channel) || CHANNEL_NAME_PATTERN.test(channel)) {
		return null;
	}
	if (/\s/.test(channel)) {
		return 'Channel names cannot contain spaces.';
	}
	if (channel.startsWith('#')) {
		return 'Channel names use lowercase letters, numbers, - and _ only.';
	}
	if (/^[CGD][A-Z0-9]*$/.test(channel)) {
		return 'Channel IDs are 9 to 12 uppercase letters or digits, like C0123456789.';
	}
	if (CHANNEL_NAME_PATTERN.test(`#${channel}`)) {
		return `Add # before channel names, like #${channel}.`;
	}
	return `Use a channel ID or a name: ${SLACK_CHANNEL_EXAMPLE}.`;
}

export function getInvalidSlackChannels(channels: string[]): string[] {
	return channels.filter((channel) => getSlackChannelError(channel) !== null);
}

export function getSlackChannelsSaveError(channels: string[]): string | null {
	const invalidCount = getInvalidSlackChannels(channels).length;
	if (invalidCount === 0) {
		return null;
	}
	const noun = invalidCount === 1 ? 'channel' : 'channels';
	return `Fix or remove ${invalidCount} malformed Slack ${noun} before saving.`;
}
