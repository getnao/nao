export class Database {
	run(query: string): void {
		if (query !== 'PRAGMA foreign_keys = ON;') {
			throwUnavailable();
		}
	}

	exec(): never {
		return throwUnavailable();
	}

	prepare(): never {
		return throwUnavailable();
	}

	transaction(): never {
		return throwUnavailable();
	}
}

function throwUnavailable(): never {
	throw new Error('bun:sqlite is not available in vitest');
}
