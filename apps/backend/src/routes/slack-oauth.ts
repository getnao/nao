import type { App } from '../app';
import { getSession } from '../auth';
import * as projectQueries from '../queries/project.queries';
import {
	buildSlackOAuthAuthorizationUrl,
	exchangeSlackOAuthCode,
	installSlackWorkspace,
	verifySlackOAuthState,
} from '../services/slack-oauth.service';
import { convertHeaders } from '../utils/utils';

export async function slackOAuthRoutes(app: App): Promise<void> {
	app.get('/install', async (request, reply) => {
		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user) {
			return reply.redirect('/settings/project/integrations/slack?slack=unauthorized');
		}

		request.actorUserId = session.user.id;
		const { projectId } = request.query as { projectId?: string };
		if (!projectId) {
			return reply.redirect('/settings/project/integrations/slack?slack=missing_project');
		}

		try {
			const role = await projectQueries.getUserRoleInProject(projectId, session.user.id);

			if (role !== 'admin') {
				return reply.redirect('/settings/project/integrations/slack?slack=forbidden');
			}

			const authorizationUrl = buildSlackOAuthAuthorizationUrl(projectId, session.user.id);

			return reply.redirect(authorizationUrl);
		} catch {
			return reply.redirect('/settings/project/integrations/slack?slack=error');
		}
	});
	app.get('/callback', { logLevel: 'silent' }, async (request, reply) => {
		const { code, state, error } = request.query as {
			code: string;
			state: string;
			error: string;
		};

		if (error || !code || !state) {
			return reply.redirect('/settings/project/integrations/slack?slack=error');
		}

		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user) {
			return reply.redirect('/settings/project/integrations/slack?slack=unauthorized');
		}

		request.actorUserId = session.user.id;

		try {
			const verifiedState = await verifySlackOAuthState(state, session.user.id);

			const role = await projectQueries.getUserRoleInProject(verifiedState.projectId, session.user.id);

			if (role !== 'admin') {
				return reply.redirect('/settings/project/integrations/slack?slack=forbidden');
			}

			const access = await exchangeSlackOAuthCode(code);

			await installSlackWorkspace({
				projectId: verifiedState.projectId,
				teamId: access.teamId,
				teamName: access.teamName,
				enterpriseId: access.enterpriseId,
				botUserId: access.botUserId,
				encryptedBotToken: access.botToken,
				scopes: access.scopes,
				installedByUserId: session.user.id,
			});

			return reply.redirect('/settings/project/integrations/slack?slack=connected');
		} catch {
			return reply.redirect('/settings/project/integrations/slack?slack=error');
		}
	});
}
