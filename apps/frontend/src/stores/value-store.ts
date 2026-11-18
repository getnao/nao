import { Store } from './abstract-store';

/** A store holding a single value, replaced as a whole. */
export class ValueStore<T> extends Store<T> {
	protected state: T;

	constructor(initialState: T) {
		super();
		this.state = initialState;
	}

	set = (value: T) => {
		if (this.state === value) {
			return;
		}
		this.state = value;
		this.notify();
	};

	getSnapshot = () => this.state;
}
