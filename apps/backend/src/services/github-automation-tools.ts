import { z } from 'zod/v4';

import type { AutomationIntegrationConfig } from '../types/automation';
import { createTool } from '../utils/tools';
import * as github from './github';

type GithubConfig = NonNullable<AutomationIntegrationConfig['github']>;

export const GITHUB_READ_TOOL_NAME = 'github_read';
export const GITHUB_WRITE_TOOL_NAMES = [
	'github_create_issue',
	'github_create_pull_request',
	'github_add_comment',
] as const;
export const GITHUB_TOOL_NAMES = [GITHUB_READ_TOOL_NAME, ...GITHUB_WRITE_TOOL_NAMES] as const;

export type GithubWriteToolName = (typeof GITHUB_WRITE_TOOL_NAMES)[number];
export type GithubToolName = (typeof GITHUB_TOOL_NAMES)[number];

export type GithubToolDescription = {
	name: GithubToolName;
	description: string;
	required: boolean;
};

type CreateGithubToolsInput = {
	githubToken: string | null;
	config: GithubConfig;
};

/**
 * Builds the GitHub tools available for an automation run.
 * - The read tool is always exposed when GitHub is enabled (the agent needs
 *   to inspect things before commenting/filing).
 * - Each write tool is only exposed if its action toggle is on.
 */
export function createGithubAutomationTools(input: CreateGithubToolsInput): Record<string, unknown> {
	if (!input.config.enabled) {
		return {};
	}

	const tools: Record<string, unknown> = {
		[GITHUB_READ_TOOL_NAME]: createReadTool(input),
	};

	const actions = input.config.actions ?? {};
	if (actions.createIssue) {
		tools.github_create_issue = createCreateIssueTool(input);
	}
	if (actions.createPullRequest) {
		tools.github_create_pull_request = createCreatePullRequestTool(input);
	}
	if (actions.addComment) {
		tools.github_add_comment = createAddCommentTool(input);
	}
	return tools;
}

/** Tools that the LLM MUST call to deliver the result (writes only). */
export function getRequiredGithubToolNames(config: GithubConfig | undefined): GithubWriteToolName[] {
	if (!config?.enabled) {
		return [];
	}
	const actions = config.actions ?? {};
	const names: GithubWriteToolName[] = [];
	if (actions.createIssue) {
		names.push('github_create_issue');
	}
	if (actions.createPullRequest) {
		names.push('github_create_pull_request');
	}
	if (actions.addComment) {
		names.push('github_add_comment');
	}
	return names;
}

/** All tools advertised to the LLM in the run prompt (read + selected writes). */
export function getGithubToolDescriptions(config: GithubConfig | undefined): GithubToolDescription[] {
	if (!config?.enabled) {
		return [];
	}
	const repos = config.repositories;
	const descriptions: GithubToolDescription[] = [
		{
			name: GITHUB_READ_TOOL_NAME,
			description: getReadToolDescription(repos),
			required: false,
		},
	];

	const actions = config.actions ?? {};
	if (actions.createIssue) {
		descriptions.push({
			name: 'github_create_issue',
			description: getCreateIssueDescription(repos),
			required: true,
		});
	}
	if (actions.createPullRequest) {
		descriptions.push({
			name: 'github_create_pull_request',
			description: getCreatePullRequestDescription(repos),
			required: true,
		});
	}
	if (actions.addComment) {
		descriptions.push({
			name: 'github_add_comment',
			description: getAddCommentDescription(repos),
			required: true,
		});
	}
	return descriptions;
}

export function isGithubToolName(name: string): name is GithubToolName {
	return (GITHUB_TOOL_NAMES as readonly string[]).includes(name);
}

// -----------------------------------------------------------------------------
// Tool implementations
// -----------------------------------------------------------------------------

const READ_OPS = ['list_issues', 'get_issue', 'list_pull_requests', 'get_pull_request', 'search', 'get_file'] as const;

function createReadTool({ githubToken, config }: CreateGithubToolsInput) {
	return createTool({
		description: getReadToolDescription(config.repositories),
		inputSchema: z.object({
			op: z.enum(READ_OPS).describe('Which read operation to perform.'),
			repo: z
				.string()
				.optional()
				.describe('Repository in "owner/name" format. Required for every op except "search".'),
			number: z
				.number()
				.int()
				.optional()
				.describe('Issue or PR number. Required for "get_issue" and "get_pull_request".'),
			state: z
				.enum(['open', 'closed', 'all'])
				.optional()
				.describe('Filter for "list_issues" and "list_pull_requests". Defaults to "open".'),
			labels: z.string().optional().describe('Comma-separated label names. Only used by "list_issues".'),
			per_page: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe('Items per page (1-50, defaults to 20). Used by list and search ops.'),
			page: z.number().int().min(1).optional().describe('1-indexed page number for list and search ops.'),
			query: z
				.string()
				.optional()
				.describe(
					'GitHub search syntax. Required for "search". Allowed repos are auto-scoped in. Example: "is:pr is:open label:bug".',
				),
			path: z.string().optional().describe('File path inside the repo. Required for "get_file".'),
			ref: z
				.string()
				.optional()
				.describe('Branch, tag, or commit SHA for "get_file". Defaults to the repo default branch.'),
			include_comments: z
				.boolean()
				.optional()
				.describe('For "get_issue" and "get_pull_request": include the comment thread. Default true.'),
			include_diff: z
				.boolean()
				.optional()
				.describe('For "get_pull_request": include the unified diff (capped). Default true.'),
		}),
		execute: async (input) => {
			const token = requireToken(githubToken);
			return runReadOp(token, config, input);
		},
	});
}

type ReadInput = {
	op: (typeof READ_OPS)[number];
	repo?: string;
	number?: number;
	state?: 'open' | 'closed' | 'all';
	labels?: string;
	per_page?: number;
	page?: number;
	query?: string;
	path?: string;
	ref?: string;
	include_comments?: boolean;
	include_diff?: boolean;
};

async function runReadOp(token: string, config: GithubConfig, input: ReadInput): Promise<unknown> {
	switch (input.op) {
		case 'list_issues': {
			const repo = requireRepo(input.repo, config);
			return github.listIssues(token, repo, {
				state: input.state,
				labels: input.labels,
				perPage: input.per_page,
				page: input.page,
			});
		}
		case 'get_issue': {
			const repo = requireRepo(input.repo, config);
			const number = requireField(input.number, 'number', 'get_issue');
			return github.getIssue(token, repo, number, {
				includeComments: input.include_comments ?? true,
			});
		}
		case 'list_pull_requests': {
			const repo = requireRepo(input.repo, config);
			return github.listPullRequests(token, repo, {
				state: input.state,
				perPage: input.per_page,
				page: input.page,
			});
		}
		case 'get_pull_request': {
			const repo = requireRepo(input.repo, config);
			const number = requireField(input.number, 'number', 'get_pull_request');
			return github.getPullRequest(token, repo, number, {
				includeComments: input.include_comments ?? true,
				includeDiff: input.include_diff ?? true,
			});
		}
		case 'search': {
			const query = requireField(input.query, 'query', 'search');
			return github.searchIssues(token, scopeSearchQuery(query, config), {
				perPage: input.per_page,
				page: input.page,
			});
		}
		case 'get_file': {
			const repo = requireRepo(input.repo, config);
			const path = requireField(input.path, 'path', 'get_file');
			return github.getFileContent(token, repo, path, input.ref);
		}
	}
}

function createCreateIssueTool({ githubToken, config }: CreateGithubToolsInput) {
	return createTool({
		description: getCreateIssueDescription(config.repositories),
		inputSchema: z.object({
			repo: z.string().describe('Target repository in "owner/name" format. Must be allowed.'),
			title: z.string().min(1).describe('Issue title.'),
			body: z.string().optional().describe('Markdown issue body.'),
			labels: z.array(z.string()).optional().describe('Label names to apply (must already exist on the repo).'),
			assignees: z.array(z.string()).optional().describe('GitHub logins to assign.'),
		}),
		execute: async ({ repo, title, body, labels, assignees }) => {
			const token = requireToken(githubToken);
			assertRepoAllowed(repo, config);
			const issue = await github.createIssue(token, repo, { title, body, labels, assignees });
			return { ok: true, repo, number: issue.number, url: issue.html_url };
		},
	});
}

function createCreatePullRequestTool({ githubToken, config }: CreateGithubToolsInput) {
	return createTool({
		description: getCreatePullRequestDescription(config.repositories),
		inputSchema: z.object({
			repo: z.string().describe('Target repository in "owner/name" format. Must be allowed.'),
			title: z.string().min(1).describe('Pull request title.'),
			head: z.string().describe('Branch the changes come from. Use "owner:branch" for cross-fork PRs.'),
			base: z.string().describe('Branch to merge into (eg "main").'),
			body: z.string().optional().describe('Markdown PR description.'),
			draft: z.boolean().optional().describe('Open as a draft PR. Default false.'),
		}),
		execute: async ({ repo, title, head, base, body, draft }) => {
			const token = requireToken(githubToken);
			assertRepoAllowed(repo, config);
			const pr = await github.createPullRequest(token, repo, { title, head, base, body, draft });
			return { ok: true, repo, number: pr.number, url: pr.html_url };
		},
	});
}

function createAddCommentTool({ githubToken, config }: CreateGithubToolsInput) {
	return createTool({
		description: getAddCommentDescription(config.repositories),
		inputSchema: z.object({
			repo: z.string().describe('Repository in "owner/name" format. Must be allowed.'),
			number: z.number().int().describe('Issue or PR number to comment on.'),
			body: z.string().min(1).describe('Comment body in GitHub-flavored markdown.'),
		}),
		execute: async ({ repo, number, body }) => {
			const token = requireToken(githubToken);
			assertRepoAllowed(repo, config);
			const comment = await github.createIssueOrPullRequestComment(token, repo, number, body);
			return { ok: true, repo, number, url: comment.html_url };
		},
	});
}

// -----------------------------------------------------------------------------
// Descriptions
// -----------------------------------------------------------------------------

function getReadToolDescription(repositories: string[]): string {
	return (
		`Read information from GitHub${formatRepoScope(repositories)}. ` +
		'Pick one `op` per call: ' +
		'`list_issues` (repo, state, labels), ' +
		'`get_issue` (repo, number, include_comments), ' +
		'`list_pull_requests` (repo, state), ' +
		'`get_pull_request` (repo, number, include_comments, include_diff), ' +
		'`search` (GitHub search syntax, auto-scoped to allowed repos), ' +
		'`get_file` (repo, path, ref?). ' +
		'Returns structured JSON. Use this to gather context before commenting or filing issues, ' +
		'or to summarize activity (open PRs, recent issues, file contents, etc.).'
	);
}

function getCreateIssueDescription(repositories: string[]): string {
	return `Create a new GitHub issue${formatRepoScope(repositories)}. Provide repo, title, and an optional markdown body, labels, and assignees.`;
}

function getCreatePullRequestDescription(repositories: string[]): string {
	return (
		`Open a pull request${formatRepoScope(repositories)}. ` +
		'Provide the target repo, title, head branch (already pushed), base branch, and optional body. ' +
		'This does NOT create branches or push commits; the head branch must already exist.'
	);
}

function getAddCommentDescription(repositories: string[]): string {
	return (
		`Post a comment on an existing GitHub issue or pull request${formatRepoScope(repositories)}. ` +
		'Provide repo, the issue or PR number, and a markdown body.'
	);
}

function formatRepoScope(repositories: string[]): string {
	if (repositories.length === 0) {
		return ' (any repository the connected GitHub account can access)';
	}
	return ` (repositories: ${repositories.join(', ')})`;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function requireToken(token: string | null): string {
	if (!token) {
		throw new Error('GitHub is not connected for the automation owner.');
	}
	return token;
}

function requireRepo(repo: string | undefined, config: GithubConfig): string {
	if (!repo) {
		throw new Error('`repo` is required (format: "owner/name").');
	}
	if (!isRepoShape(repo)) {
		throw new Error(`Invalid repo "${repo}". Use the "owner/name" format.`);
	}
	assertRepoAllowed(repo, config);
	return repo;
}

function requireField<T>(value: T | undefined, field: string, op: string): T {
	if (value === undefined || value === null || value === '') {
		throw new Error(`\`${field}\` is required for op "${op}".`);
	}
	return value;
}

function assertRepoAllowed(repo: string, config: GithubConfig): void {
	if (config.repositories.length === 0) {
		return;
	}
	if (!config.repositories.includes(repo)) {
		throw new Error(`Repository "${repo}" is not enabled for this automation.`);
	}
}

function scopeSearchQuery(query: string, config: GithubConfig): string {
	if (config.repositories.length === 0) {
		return query;
	}
	if (/\brepo:/i.test(query)) {
		return query;
	}
	const repoQualifier = config.repositories.map((repo) => `repo:${repo}`).join(' ');
	return `${repoQualifier} ${query}`.trim();
}

function isRepoShape(value: string): boolean {
	return /^[\w.-]+\/[\w.-]+$/.test(value);
}
