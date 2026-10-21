import { type Root, toPlainText, walkAst } from 'chat';

const HTTP_URL_REGEX = /^https?:\/\//i;
const SLACK_MRKDWN_LINK_REGEX = /<(https?:\/\/[^|<>]+)(?:\|([^<>]*))?>/g;

/**
 * Plain text of a parsed Slack message with link targets kept. Slack sends a pasted
 * long URL as `<url|shortened label>` and the chat adapter's `Message.text` keeps only
 * the label, so the agent would never see the URL. Reads the adapter's AST rather than
 * the raw event so inline user mentions keep their resolved display names.
 */
export function slackPlainTextWithLinks(formatted: Root): string {
	const withLinkTargets = walkAst(structuredClone(formatted), (node) =>
		node.type === 'link'
			? { type: 'text', value: formatSlackLink(node.url, toPlainText({ type: 'root', children: node.children })) }
			: node,
	);
	return toPlainText(withLinkTargets);
}

/** For raw Slack mrkdwn (e.g. `conversations.replies` text) that never went through the adapter. */
export function expandSlackMrkdwnLinks(mrkdwn: string): string {
	return mrkdwn.replace(SLACK_MRKDWN_LINK_REGEX, (_match, url: string, label: string | undefined) =>
		formatSlackLink(decodeSlackEntities(url), decodeSlackEntities(label ?? '')),
	);
}

function formatSlackLink(url: string, label: string): string {
	if (!HTTP_URL_REGEX.test(url)) {
		return label;
	}
	const shownLabel = label.trim();
	const labelPrefix = stripScheme(shownLabel).replace(/(?:…|\.\.\.)$/, '');
	if (!labelPrefix || stripScheme(url).toLowerCase().startsWith(labelPrefix.toLowerCase())) {
		return url;
	}
	return `${shownLabel} (${url})`;
}

function stripScheme(value: string): string {
	return value.replace(HTTP_URL_REGEX, '');
}

function decodeSlackEntities(value: string): string {
	return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
