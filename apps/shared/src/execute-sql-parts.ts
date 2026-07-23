type MessageWithParts<TPart> = {
	parts: TPart[];
};

/**
 * Parts whose query id was re-run later in the conversation (in-place edits).
 * Identity is by object reference — call before cloning parts.
 */
export function findSupersededExecuteSqlParts<TPart>(messages: Array<MessageWithParts<TPart>>): Set<TPart> {
	const latestByQueryId = new Map<string, TPart>();
	for (const message of messages) {
		for (const part of message.parts) {
			const queryId = getExecuteSqlQueryId(part);
			if (queryId) {
				latestByQueryId.set(queryId, part);
			}
		}
	}

	const superseded = new Set<TPart>();
	for (const message of messages) {
		for (const part of message.parts) {
			const queryId = getExecuteSqlQueryId(part);
			if (queryId && latestByQueryId.get(queryId) !== part) {
				superseded.add(part);
			}
		}
	}
	return superseded;
}

/** Drop superseded execute_sql parts (UI). */
export function filterSupersededExecuteSqlParts<TPart, TMessage extends MessageWithParts<TPart>>(
	messages: TMessage[],
): TMessage[] {
	const superseded = findSupersededExecuteSqlParts(messages);
	if (superseded.size === 0) {
		return messages;
	}

	return messages.map((message) => {
		const parts = message.parts.filter((part) => !superseded.has(part));
		return parts.length === message.parts.length ? message : { ...message, parts };
	});
}

/** Flag superseded execute_sql parts so the model sees a stub (agent context). */
export function markSupersededExecuteSqlParts<TPart, TMessage extends MessageWithParts<TPart>>(
	messages: TMessage[],
): TMessage[] {
	const superseded = findSupersededExecuteSqlParts(messages);
	if (superseded.size === 0) {
		return messages;
	}

	return messages.map((message) => {
		let changed = false;
		const parts = message.parts.map((part) => {
			if (!superseded.has(part)) {
				return part;
			}
			changed = true;
			const output =
				part && typeof part === 'object' && 'output' in part && part.output && typeof part.output === 'object'
					? part.output
					: {};
			return {
				...part,
				output: { ...output, superseded: true },
			};
		});
		return changed ? { ...message, parts } : message;
	});
}

function getExecuteSqlQueryId(part: unknown): string | null {
	if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'tool-execute_sql') {
		return null;
	}
	if (!('output' in part) || !part.output || typeof part.output !== 'object' || !('id' in part.output)) {
		return null;
	}
	const id = part.output.id;
	return typeof id === 'string' ? id : null;
}
