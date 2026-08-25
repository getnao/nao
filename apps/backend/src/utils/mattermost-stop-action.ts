export type MattermostStopAttachment = {
	color: '#522bff';
	actions: [
		{
			id: 'stop_generation';
			name: 'Stop';
			type: 'button';
			integration: {
				url: string;
				context: { action_id: 'stop_generation' };
			};
		},
	];
};

export type MattermostAnswerPatchBody = {
	message: string;
	props: Record<string, unknown> & {
		attachments: MattermostStopAttachment[];
	};
};

export function createMattermostStopAttachment(callbackUrl: string): MattermostStopAttachment {
	return {
		color: '#522bff',
		actions: [
			{
				id: 'stop_generation',
				name: 'Stop',
				type: 'button',
				integration: {
					url: callbackUrl,
					context: { action_id: 'stop_generation' },
				},
			},
		],
	};
}

export function getMattermostPostBaseProps(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const props = (raw as { props?: unknown }).props;
	return props && typeof props === 'object' && !Array.isArray(props) ? { ...props } : {};
}

export function buildMattermostAnswerPatchBody(
	message: string,
	baseProps: Record<string, unknown>,
	attachments: MattermostStopAttachment[],
): MattermostAnswerPatchBody {
	return {
		message,
		props: {
			...baseProps,
			attachments,
		},
	};
}

export async function patchMattermostAnswerPost(input: {
	baseUrl: string;
	botToken: string;
	postId: string;
	message: string;
	baseProps: Record<string, unknown>;
	attachments: MattermostStopAttachment[];
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const url = createMattermostPostPatchUrl(input.baseUrl, input.postId);
	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${input.botToken}`,
		'Content-Type': 'application/json',
	};
	const response = await fetchImpl(url, {
		method: 'PUT',
		headers,
		body: JSON.stringify(buildMattermostAnswerPatchBody(input.message, input.baseProps, input.attachments)),
	});
	if (!response.ok) {
		throw new Error(`Mattermost post patch failed with status ${response.status}`);
	}
}

function createMattermostPostPatchUrl(baseUrl: string, postId: string): URL {
	const url = new URL(baseUrl);
	const basePath = url.pathname.replace(/\/$/, '');
	url.pathname = `${basePath}/api/v4/posts/${encodeURIComponent(postId)}/patch`;
	return url;
}
