import { describe, expect, it } from 'vitest';

import { buildDiscordAnswerPostable, DISCORD_ANSWERING_PLACEHOLDER } from '../src/services/discord-helpers';

/**
 * The answer message is edited repeatedly while it streams. The adapter writes `content` for a markdown
 * postable but never clears the embed and components a card wrote, so mixing the two postable types on
 * one message renders the answer twice -- markdown text plus a stale embed behind a detached Stop button.
 * Every edit must therefore use the same type: a card.
 */
describe('buildDiscordAnswerPostable', () => {
	it('is always a card, never a markdown postable', () => {
		for (const stopAttached of [true, false]) {
			const postable = buildDiscordAnswerPostable('an answer', stopAttached);
			expect(postable).not.toHaveProperty('markdown');
			expect(postable).toMatchObject({ type: 'card' });
		}
	});

	it('keeps the answer text', () => {
		expect(JSON.stringify(buildDiscordAnswerPostable('an answer', true))).toContain('an answer');
	});

	it('always carries the Stop action, disabled once generation ends', () => {
		const generating = JSON.stringify(buildDiscordAnswerPostable('an answer', true));
		const finished = JSON.stringify(buildDiscordAnswerPostable('an answer', false));
		// Both keep the action row: the adapter only sends `components` when the card has some, so
		// omitting it would leave the previous, still-clickable Stop button on the message.
		expect(generating).toContain('stop_generation');
		expect(finished).toContain('stop_generation');
		expect(generating).not.toContain('"disabled":true');
		expect(finished).toContain('"disabled":true');
	});

	it('falls back to the placeholder when there is no text yet', () => {
		expect(JSON.stringify(buildDiscordAnswerPostable('', true))).toContain(DISCORD_ANSWERING_PLACEHOLDER);
	});
});
