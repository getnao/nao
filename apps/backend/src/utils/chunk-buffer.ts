export interface ChunkBatch<T> {
	chunks: T[];
	isClosed: boolean;
}

/** Keeps every chunk of a stream, so a reader joining late replays it from the start and then follows it live. */
export class ChunkBuffer<T> {
	private readonly _chunks: T[] = [];
	private readonly _waiters = new Set<() => void>();
	private _isClosed = false;

	push(chunk: T): void {
		if (this._isClosed) {
			return;
		}
		this._chunks.push(chunk);
		this._wakeWaiters();
	}

	close(): void {
		this._isClosed = true;
		this._wakeWaiters();
	}

	/** Waits until chunks exist past `fromIndex` or the buffer closes, then returns them. */
	async next(fromIndex: number): Promise<ChunkBatch<T>> {
		while (fromIndex >= this._chunks.length && !this._isClosed) {
			await new Promise<void>((resolve) => this._waiters.add(resolve));
		}
		return { chunks: this._chunks.slice(fromIndex), isClosed: this._isClosed };
	}

	read(): ReadableStream<T> {
		let index = 0;
		let isCancelled = false;
		return new ReadableStream<T>({
			pull: async (controller) => {
				const { chunks, isClosed } = await this.next(index);
				if (isCancelled) {
					return;
				}
				index += chunks.length;
				chunks.forEach((chunk) => controller.enqueue(chunk));
				if (isClosed) {
					controller.close();
				}
			},
			cancel: () => {
				isCancelled = true;
			},
		});
	}

	private _wakeWaiters(): void {
		const waiters = [...this._waiters];
		this._waiters.clear();
		waiters.forEach((wake) => wake());
	}
}
