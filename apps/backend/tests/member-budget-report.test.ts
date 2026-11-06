import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getMemberBudgetOverview: vi.fn() }));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/member-budget.service', () => ({
	getMemberBudgetOverview: mocks.getMemberBudgetOverview,
}));

import { buildMemberBudgetReportCsv, getMemberBudgetReport } from '../src/services/member-budget-report.service';

describe('member budget report', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getMemberBudgetOverview.mockResolvedValue({
			period: 'month',
			defaultLimitUsd: 100,
			groups: [
				{ id: 'everyone', name: 'All Users', isDefault: true, limitUsd: 100 },
				{ id: 'analysts', name: 'Analysts', isDefault: false, limitUsd: 300 },
				{ id: 'interns', name: 'Interns', isDefault: false, limitUsd: null },
			],
			members: [
				member({ id: 'ada', name: 'Ada', spendUsd: 40, groupIds: ['interns'] }),
				member({ id: 'bob', name: 'Bob', spendUsd: 290.5, groupIds: ['analysts'] }),
				member({ id: 'cy', name: 'Cy', spendUsd: 12, personalLimitUsd: 0 }),
				member({ id: 'dee', name: 'Dee', spendUsd: 150, personalLimitUsd: 120 }),
			],
		});
	});

	it('resolves each member budget like the settings page, highest spenders first', async () => {
		const report = await getMemberBudgetReport('project-id');

		expect(report.period).toBe('month');
		expect(
			report.members.map(({ name, groups, limitUsd, source, remainingUsd, status }) => ({
				name,
				groups,
				limitUsd,
				source,
				remainingUsd,
				status,
			})),
		).toEqual([
			{
				name: 'Bob',
				groups: ['All Users', 'Analysts'],
				limitUsd: 300,
				source: 'group',
				remainingUsd: 9.5,
				status: 'close',
			},
			{
				name: 'Dee',
				groups: ['All Users'],
				limitUsd: 120,
				source: 'personal',
				remainingUsd: 0,
				status: 'exceeded',
			},
			{
				name: 'Ada',
				groups: ['All Users', 'Interns'],
				limitUsd: 100,
				source: 'default',
				remainingUsd: 60,
				status: 'under',
			},
			{
				name: 'Cy',
				groups: ['All Users'],
				limitUsd: null,
				source: 'personal',
				remainingUsd: null,
				status: 'unlimited',
			},
		]);
	});

	it('writes one CSV row per member and leaves the budget empty when there is no limit', async () => {
		const csv = buildMemberBudgetReportCsv(await getMemberBudgetReport('project-id'));
		const [header, ...rows] = csv.split('\n');

		expect(header).toBe(
			'Member,Email,Groups,Period,Period start,Resets on,Usage (USD),Budget (USD),Budget source,Remaining (USD),Status',
		);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatch(
			/^Bob,bob@example\.com,All Users; Analysts,month,\d{4}-\d{2}-01,\d{4}-\d{2}-01,290\.5,300,/,
		);
		expect(rows[3]).toMatch(/,12,,Personal limit,,No limit$/);
	});

	it('neutralizes spreadsheet formulas in member names', async () => {
		mocks.getMemberBudgetOverview.mockResolvedValue({
			period: 'week',
			defaultLimitUsd: 0,
			groups: [],
			members: [member({ id: 'eve', name: '=HYPERLINK("https://evil.test","x")', spendUsd: 1 })],
		});

		const csv = buildMemberBudgetReportCsv(await getMemberBudgetReport('project-id'));

		expect(csv.split('\n')[1]).toMatch(/^"'=HYPERLINK\(""https:\/\/evil\.test"",""x""\)",/);
	});
});

function member(overrides: {
	id: string;
	name: string;
	spendUsd: number;
	personalLimitUsd?: number;
	groupIds?: string[];
}) {
	return {
		email: `${overrides.id}@example.com`,
		personalLimitUsd: null,
		groupIds: [],
		...overrides,
	};
}
