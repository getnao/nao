import { observable } from '@trpc/server/observable';
import { clearStaleActiveOrganization } from './active-organization';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { TRPCLink } from '@trpc/client';

export function createActiveOrganizationRecovery({
	invalidateQueries,
	invalidateRouter,
}: {
	invalidateQueries: () => void;
	invalidateRouter: () => void;
}) {
	const requestOrganizationIds = new Map<number, string | null>();
	const link: TRPCLink<TrpcRouter> = () => {
		return ({ next, op }) => {
			return observable((observer) => {
				const subscription = next(op).subscribe({
					next(result) {
						observer.next(result);
					},
					error(error) {
						const organizationId = requestOrganizationIds.get(op.id) ?? null;
						requestOrganizationIds.delete(op.id);
						const cleared =
							op.path === 'organization.get' && clearStaleActiveOrganization(organizationId, error);

						observer.error(error);
						if (cleared) {
							queueMicrotask(() => {
								invalidateQueries();
								invalidateRouter();
							});
						}
					},
					complete() {
						requestOrganizationIds.delete(op.id);
						observer.complete();
					},
				});

				return () => {
					requestOrganizationIds.delete(op.id);
					subscription.unsubscribe();
				};
			});
		};
	};

	return {
		link,
		trackRequests(operationIds: number[], organizationId: string | null) {
			for (const operationId of operationIds) {
				requestOrganizationIds.set(operationId, organizationId);
			}
		},
	};
}
