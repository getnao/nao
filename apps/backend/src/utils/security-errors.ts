/** A URL refused because it leads to a private, loopback or metadata address. */
export class UnsafeUrlError extends Error {
	constructor(
		message: string,
		readonly host: string,
	) {
		super(message);
		this.name = 'UnsafeUrlError';
	}
}

/** A path refused because it leads out of the folder it must stay in. */
export class PathEscapeError extends Error {
	constructor(
		message: string,
		readonly requestedPath: string,
	) {
		super(message);
		this.name = 'PathEscapeError';
	}
}
