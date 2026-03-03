import type { UIMessage } from '@nao/backend/chat';

/**
 * Scans story code for <chart|table query_id="..."> references and collects
 * matching SQL query result data from chat messages so embeds can render
 * in the shared standalone view.
 */
export function collectQueryDataFromMessages(messages: UIMessage[], code: string): Record<string, unknown[]> | null {
	const chartRegex = /<(?:chart|table)\s+[^>]*query_id="([^"]*)"[^>]*\/?>/g;
	const queryIds = new Set<string>();
	let match;
	while ((match = chartRegex.exec(code)) !== null) {
		queryIds.add(match[1]);
	}

	if (queryIds.size === 0) {
		return null;
	}

	const data: Record<string, unknown[]> = {};
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === 'tool-execute_sql' && part.output?.id && queryIds.has(part.output.id)) {
				data[part.output.id] = part.output.data;
			}
		}
	}

	return Object.keys(data).length > 0 ? data : null;
}
