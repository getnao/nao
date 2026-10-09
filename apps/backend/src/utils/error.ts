export type HandlerErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

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

export class BudgetExceededError extends HandlerError {
	constructor(message: string) {
		super('FORBIDDEN', message);
		this.name = 'BudgetExceededError';
	}
}

export class ManagedCreditsExhaustedError extends HandlerError {
	constructor() {
		super(
			'FORBIDDEN',
			"Your organization's nao-managed AI credits have been used. Add a project provider key to continue.",
		);
		this.name = 'ManagedCreditsExhaustedError';
	}
}

export class WelcomeGrantConfirmationRequiredError extends HandlerError {
	constructor() {
		super('FORBIDDEN', 'Confirm the organization for your welcome credit before using nao-managed AI.');
		this.name = 'WelcomeGrantConfirmationRequiredError';
	}
}

const httpStatusByHandlerErrorCode: Record<HandlerErrorCode, number> = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
};
