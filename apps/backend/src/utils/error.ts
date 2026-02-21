export type HandlerErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND';

/**
 * A general error class for route/procedure handling errors.
 */
export class HandlerError extends Error {
	readonly codeMessage: HandlerErrorCode;
	readonly code: number;

	constructor(codeMessage: HandlerErrorCode, message: string) {
		super(message);
		this.name = 'HandlerError';
		this.codeMessage = codeMessage;
		this.code = httpStatusByHandlerErrorCode[codeMessage] ?? 500;
	}
}

const httpStatusByHandlerErrorCode: Record<HandlerErrorCode, number> = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
};
