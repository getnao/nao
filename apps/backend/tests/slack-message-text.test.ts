import { SlackFormatConverter } from '@chat-adapter/slack';
import { describe, expect, it } from 'vitest';

import { expandSlackMrkdwnLinks, slackPlainTextWithLinks } from '../src/utils/slack-message-text';

const converter = new SlackFormatConverter();
const LONG_URL = 'https://explorer.example.com/address/0x8f3a1c9e2b7d4f6a0c5e8b1d3f7a9c2e4b6d8f0a';

/** Mirrors the adapter: `Message.formatted` is `toAst` of the event text after mention resolution. */
function agentText(mrkdwn: string): string {
	return slackPlainTextWithLinks(converter.toAst(mrkdwn));
}

describe('slackPlainTextWithLinks', () => {
	it('keeps the URL of a link Slack shortened to a truncated label', () => {
		const raw = `<${LONG_URL}|explorer.example.com/address/0x8f3a…>\nwhat do we know about this address?`;

		expect(converter.extractPlainText(raw)).not.toContain(LONG_URL);
		expect(agentText(raw)).toBe(`${LONG_URL}\nwhat do we know about this address?`);
	});

	it('keeps label and URL when the label is not part of the URL', () => {
		expect(agentText('see <https://example.com/docs?a=1&amp;b=2|the docs> please')).toBe(
			'see the docs (https://example.com/docs?a=1&b=2) please',
		);
	});

	it('keeps resolved user mentions and bare links', () => {
		expect(agentText(`<@U0BOT> ask <@U123|Ada> about <${LONG_URL}> and https://example.com/x`)).toBe(
			`@U0BOT ask @Ada about ${LONG_URL} and https://example.com/x`,
		);
	});

	it('does not mutate the message AST', () => {
		const formatted = converter.toAst(`<${LONG_URL}|explorer.example.com/…>`);
		slackPlainTextWithLinks(formatted);
		expect(JSON.stringify(formatted)).toContain('"type":"link"');
	});
});

describe('expandSlackMrkdwnLinks', () => {
	it('expands labelled links in raw mrkdwn', () => {
		expect(
			expandSlackMrkdwnLinks(`check <${LONG_URL}|explorer.example.com/…> and <https://example.com|site>`),
		).toBe(`check ${LONG_URL} and site (https://example.com)`);
	});

	it('leaves mentions, channels and non-http links untouched', () => {
		const text = '<@U123|ada> in <#C1|data> <mailto:a@b.com|a@b.com> <!here>';
		expect(expandSlackMrkdwnLinks(text)).toBe(text);
	});
});
