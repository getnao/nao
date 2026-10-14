export const SSE_KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

/**
 * Writes an SSE comment whenever the stream stays silent for the interval, so proxies with an idle
 * timeout (e.g. AWS ALB, 60s by default) keep the connection open while the agent thinks or runs a
 * long tool. SSE clients ignore comments. Nothing is queued while the consumer still has unread
 * output, so a slow client never accumulates keep-alives.
 */
export function withSseKeepAlive(stream: ReadableStream<string>, intervalMs: number): ReadableStream<string> {
	const reader = stream.getReader();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const scheduleKeepAlive = (controller: ReadableStreamDefaultController<string>) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			if ((controller.desiredSize ?? 0) > 0) {
				controller.enqueue(SSE_KEEP_ALIVE_COMMENT);
			}
			scheduleKeepAlive(controller);
		}, intervalMs);
	};

	return new ReadableStream<string>({
		start(controller) {
			scheduleKeepAlive(controller);
		},
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					clearTimeout(timer);
					controller.close();
					return;
				}
				controller.enqueue(value);
				scheduleKeepAlive(controller);
			} catch (error) {
				clearTimeout(timer);
				throw error;
			}
		},
		cancel(reason) {
			clearTimeout(timer);
			return reader.cancel(reason);
		},
	});
}
