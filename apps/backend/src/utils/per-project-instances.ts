/**
 * One instance per project, so requests of different projects never share mutable state. Past
 * `maxInstances`, the least recently used instance is dropped; a request already holding it
 * finishes with it.
 */
export class PerProjectInstances<T> {
	private readonly _instances = new Map<string, T>();

	constructor(
		private readonly _options: {
			create: () => T;
			maxInstances?: number;
			onEvict?: (instance: T) => void;
		},
	) {}

	public get(projectId: string): T {
		const existing = this._instances.get(projectId);
		if (existing) {
			this._markRecentlyUsed(projectId, existing);
			return existing;
		}

		const created = this._options.create();
		this._instances.set(projectId, created);
		this._evictOverflow();
		return created;
	}

	/** The project's instance if it already exists, without creating one. */
	public peek(projectId: string): T | undefined {
		return this._instances.get(projectId);
	}

	private _markRecentlyUsed(projectId: string, instance: T): void {
		this._instances.delete(projectId);
		this._instances.set(projectId, instance);
	}

	private _evictOverflow(): void {
		const maxInstances = this._options.maxInstances ?? Infinity;
		while (this._instances.size > maxInstances) {
			const [oldestProjectId, oldest] = this._instances.entries().next().value!;
			this._instances.delete(oldestProjectId);
			this._options.onEvict?.(oldest);
		}
	}
}
