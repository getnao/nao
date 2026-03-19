/**
 * Buffers a ReadableStream in memory and allows creating multiple readers
 * that replay buffered content and continue with live data.
 *
 * Used to support stream resumption: the original client reads from one reader,
 * and if it disconnects (e.g. browser refresh), a new reader can be created to
 * replay everything from the start and continue with new chunks.
 */
export class StreamBuffer<T> {
	private _chunks: T[] = [];
	private _done = false;
	private _error?: unknown;
	private _waiters: Array<() => void> = [];

	constructor(stream: ReadableStream<T>) {
		this._consume(stream);
	}

	get isActive(): boolean {
		return !this._done && !this._error;
	}

	createReader(filter?: (chunk: T) => boolean): ReadableStream<T> {
		let index = 0;

		return new ReadableStream({
			pull: async (controller) => {
				while (index >= this._chunks.length) {
					if (this._done) {
						controller.close();
						return;
					}
					if (this._error) {
						controller.error(this._error);
						return;
					}
					await this._waitForChange();
				}

				const chunk = this._chunks[index++];
				if (!filter || filter(chunk)) {
					controller.enqueue(chunk);
				}
			},
		});
	}

	private async _consume(stream: ReadableStream<T>): Promise<void> {
		const reader = stream.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				this._chunks.push(value);
				this._notifyWaiters();
			}
			this._done = true;
			this._notifyWaiters();
		} catch (err) {
			this._error = err;
			this._notifyWaiters();
		}
	}

	private _waitForChange(): Promise<void> {
		return new Promise((resolve) => {
			this._waiters.push(resolve);
		});
	}

	private _notifyWaiters(): void {
		const waiters = this._waiters;
		this._waiters = [];
		for (const waiter of waiters) {
			waiter();
		}
	}
}
