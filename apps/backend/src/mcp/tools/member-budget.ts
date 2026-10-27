/* @license Enterprise */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MEMBER_BUDGET_PERIODS } from '@nao/shared/types';
import { z } from 'zod';

import { buildMemberBudgetReportCsv, getMemberBudgetReport } from '../../services/member-budget-report.service';
import { isMemberBudgetLicensed } from '../../utils/member-budget';
import type { McpContext } from '../logging';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const EXPORT_MEMBER_BUDGETS_DESCRIPTION =
	'Export the AI usage and budget of every member of the nao project over the current budget period ' +
	'(admins only), as structured rows and as a ready-to-save CSV in `csv`.\n\n' +
	'USE WHEN: the user asks who spends the most on AI, who is over or close to their budget, or wants a ' +
	'usage/budget report or CSV file.\n' +
	'Usage and budgets are in USD across all providers; a member with no limit has a null budget.';

const MEMBER_ROW_SCHEMA = z.object({
	name: z.string(),
	email: z.string(),
	groups: z.array(z.string()).describe('User groups the member belongs to.'),
	spendUsd: z.number().describe('Spend over the current period, in USD.'),
	limitUsd: z.number().nullable().describe('Budget for the period in USD, or null when the member has no limit.'),
	source: z.enum(['personal', 'group', 'default']).describe('Where the budget comes from.'),
	remainingUsd: z.number().nullable().describe('Budget left this period in USD, or null when there is no limit.'),
	status: z.enum(['under', 'close', 'exceeded', 'unlimited']),
});

/** Member budgets are an Enterprise feature that only admins manage in the UI. */
export async function registerMemberBudgetTools(server: McpServer, ctx: McpContext): Promise<void> {
	if (ctx.role !== 'admin' || !(await isMemberBudgetLicensed(ctx.projectId))) {
		return;
	}
	registerMcpTool(server, ctx, {
		name: 'export_member_budgets',
		title: 'Export Member Budgets',
		description: EXPORT_MEMBER_BUDGETS_DESCRIPTION,
		inputSchema: {},
		outputSchema: {
			period: z.enum(MEMBER_BUDGET_PERIODS).describe('Budget period that usage is measured over.'),
			periodStart: z.string().describe('Start of the current period (ISO date, UTC).'),
			resetsAt: z.string().describe('When usage resets for the next period (ISO date, UTC).'),
			members: z.array(MEMBER_ROW_SCHEMA).describe('Every project member, highest spenders first.'),
			csv: z.string().describe('The same rows as CSV, ready to save as a file.'),
		},
		handler: async () => {
			const report = await getMemberBudgetReport(ctx.projectId);
			return jsonToolResult({
				period: report.period,
				periodStart: report.periodStart.toISOString(),
				resetsAt: report.resetsAt.toISOString(),
				members: report.members,
				csv: buildMemberBudgetReportCsv(report),
			});
		},
	});
}
