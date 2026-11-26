import { enqueueVerifiedUserWelcomeEmail } from '../auth';
import * as userQueries from '../queries/user.queries';
import type { JobHandler } from '../services/scheduler.service';
import { fetchSignupReviews } from '../services/signup-screening.service';
import { logger } from '../utils/logger';

export const SIGNUP_REVIEW_SYNC_JOB_NAME = 'signup-review.sync';

/** The most emails the screening service answers about in one call. */
const REVIEW_BATCH_SIZE = 500;

/** Applies the decisions teammates took on Slack to the accounts held by signup screening. */
export const signupReviewSyncHandler: JobHandler = async () => {
	const pendingUsers = await userQueries.listUsersPendingSignupReview(REVIEW_BATCH_SIZE);
	const reviews = await fetchSignupReviews(pendingUsers.map((user) => user.email));
	const userIdByEmail = new Map(pendingUsers.map((user) => [user.email.toLowerCase(), user.id]));

	for (const { email, status } of reviews) {
		const userId = userIdByEmail.get(email.toLowerCase());
		if (!userId || status === 'pending' || !(await userQueries.settleSignupReview(userId, status))) {
			continue;
		}
		logger.info(
			status === 'allow' ? 'Released a signup approved on Slack' : 'Deactivated a signup blocked on Slack',
			{
				source: 'system',
				context: { userId, email },
			},
		);
		if (status === 'allow') {
			await enqueueVerifiedUserWelcomeEmail(userId);
		}
	}
};
