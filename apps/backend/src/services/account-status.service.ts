import { isUserDeactivated } from '../queries/user.queries';
import { HandlerError } from '../utils/error';

export const DEACTIVATED_ACCOUNT_MESSAGE = 'This account has been deactivated.';

export async function assertUserIsActive(userId: string): Promise<void> {
	if (await isUserDeactivated(userId)) {
		throw new HandlerError('FORBIDDEN', DEACTIVATED_ACCOUNT_MESSAGE);
	}
}
