interface TestCallerOptions {
	userId?: string;
	selectedProjectId?: string | null;
	selectedOrganizationId?: string | null;
}

interface CallerFactory<TCaller> {
	createCaller: (context: never) => TCaller;
}

/** Signed-in tRPC caller whose email is derived from its id, with `project-id` selected unless overridden. */
export function createTestCaller<TCaller>(router: CallerFactory<TCaller>, options: TestCallerOptions = {}): TCaller {
	const { userId = 'user-id', ...selection } = options;
	return router.createCaller({
		session: {
			user: { id: userId, name: 'Test User', email: `${userId}@example.com` },
			session: { token: 'session-token' },
		},
		selectedProjectId: 'project-id',
		...selection,
	} as never);
}
