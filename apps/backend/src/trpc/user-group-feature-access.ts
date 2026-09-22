import type { UserGroupFeature } from '@nao/shared';
import { TRPCError } from '@trpc/server';

import { assertUserGroupFeature, UserGroupFeatureAccessError } from '../services/user-group-feature-access.service';

export async function assertUserGroupFeatureForTrpc(
	projectId: string,
	userId: string,
	feature: UserGroupFeature,
): Promise<void> {
	try {
		await assertUserGroupFeature(projectId, userId, feature);
	} catch (error) {
		if (error instanceof UserGroupFeatureAccessError) {
			throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
		}
		throw error;
	}
}
