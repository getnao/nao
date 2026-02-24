type Listener = () => void;

/**
 * A store whose consumers can subscribe to the entire state.
 */
export abstract class Store<T> {
	protected abstract state: T;
	private readonly listeners = new Set<Listener>();

	protected readonly notify = () => {
		this.listeners.forEach((fn) => fn());
	};

	public subscribe = (callback: Listener) => {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	};
}

/**
 * A store whose consumers can subscribe to a specific key allowing them to get key-specific updates and state snapshots.
 */
export abstract class SelectorStore<T> {
	protected abstract state: T;
	private readonly listeners = new Map<string, Set<Listener>>();

	protected readonly notify = (key: string) => {
		this.listeners.get(key)?.forEach((fn) => fn());
	};

	public subscribe = (key: string, callback: Listener) => {
		if (!this.listeners.has(key)) {
			this.listeners.set(key, new Set());
		}

		this.listeners.get(key)!.add(callback);

		return () => {
			const keyListeners = this.listeners.get(key);
			if (!keyListeners) {
				return;
			}
			keyListeners.delete(callback);
			if (keyListeners.size === 0) {
				this.listeners.delete(key);
			}
		};
	};
}
