import { TRPCError } from '@trpc/server';

const CLOUD_PASSWORD_RESET_MESSAGE =
	'Administrator password resets are unavailable in nao cloud. Use self-service password recovery instead.';

export function assertAdminPasswordResetAllowed(isCloud: boolean): void {
	if (isCloud) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: CLOUD_PASSWORD_RESET_MESSAGE,
		});
	}
}
