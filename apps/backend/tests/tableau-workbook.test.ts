import { parseTableauWorkbook } from '@nao/shared/tools';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { strToU8, zipSync } from 'fflate';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import parseTableauWorkbookTool from '../src/agents/tools/parse-tableau-workbook';
import { parseTableauWorkbookBytes, parseTableauWorkbookXml } from '../src/services/tableau-workbook';
import type { ToolContext } from '../src/types/tools';

const WORKBOOK_XML = `<?xml version='1.0'?>
<workbook>
  <worksheets>
    <worksheet name='Total Sales' />
    <worksheet name='Monthly Sales' />
    <worksheet name='Profit by Region' />
    <worksheet name='Unused Scratch' />
  </worksheets>
  <dashboards>
    <dashboard name='Sales Overview'>
      <size height='800' width='1200' />
      <zones>
        <zone id='root' param='vert' type-v2='layout-flow' x='0' y='0' w='1200' h='800'>
          <zone id='kpi' name='Total Sales' x='0' y='0' w='1200' h='200' />
          <zone id='charts' param='horz' type-v2='layout-flow' x='0' y='200' w='1200' h='600'>
            <zone id='trend' name='Monthly Sales' x='0' y='200' w='700' h='600' />
            <zone id='region' name='Profit by Region' x='700' y='200' w='500' h='600' />
            <zone id='filter' name='Monthly Sales' param='[Region]' type-v2='filter' />
          </zone>
        </zone>
      </zones>
      <devicelayouts>
        <devicelayout name='phone'>
          <zones><zone name='Total Sales' x='0' y='0' w='320' h='600' /></zones>
        </devicelayout>
      </devicelayouts>
    </dashboard>
  </dashboards>
</workbook>`;

describe('parseTableauWorkbookXml', () => {
	it('returns exact dashboard membership and desktop layout', () => {
		const workbook = parseTableauWorkbookXml(WORKBOOK_XML);

		expect(workbook.dashboards).toEqual([
			expect.objectContaining({
				name: 'Sales Overview',
				width: 1200,
				height: 800,
				worksheets: ['Total Sales', 'Monthly Sales', 'Profit by Region'],
				layout_rows: [['Total Sales'], ['Monthly Sales', 'Profit by Region']],
				controls: [{ type: 'filter', field: '[Region]', worksheet: 'Monthly Sales' }],
			}),
		]);
		expect(workbook.skipped_worksheets).toEqual(['Unused Scratch']);
	});

	it('preserves nested containers and flow direction', () => {
		const dashboard = parseTableauWorkbookXml(WORKBOOK_XML).dashboards[0]!;

		expect(dashboard.zones).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'root', flow_direction: 'vertical' }),
				expect.objectContaining({ id: 'charts', parent_id: 'root', flow_direction: 'horizontal' }),
				expect.objectContaining({
					id: 'trend',
					parent_id: 'charts',
					worksheet: 'Monthly Sales',
					width: 700,
				}),
			]),
		);
		expect(dashboard.zones.filter((zone) => zone.worksheet === 'Total Sales')).toHaveLength(1);
	});

	it('limits output to one named dashboard and rejects guesses', () => {
		expect(parseTableauWorkbookXml(WORKBOOK_XML, 'sales_overview').dashboards).toHaveLength(1);
		expect(() => parseTableauWorkbookXml(WORKBOOK_XML, 'Guessed Dashboard')).toThrow(
			'No dashboard named "Guessed Dashboard"',
		);
	});

	it('matches the public tool contract', () => {
		const workbook = parseTableauWorkbookXml(WORKBOOK_XML);

		expect(() => parseTableauWorkbook.OutputSchema.parse({ _version: '1', success: true, workbook })).not.toThrow();
	});
});

describe('parseTableauWorkbookBytes', () => {
	it('reads TWBX archives without inflating embedded data', () => {
		const twbx = zipSync({
			'Fixture.twb': strToU8(WORKBOOK_XML),
			'Data/sales.csv': strToU8('Sales\n100\n'),
		});

		expect(parseTableauWorkbookBytes(Buffer.from(twbx)).dashboards[0]?.worksheets).toEqual([
			'Total Sales',
			'Monthly Sales',
			'Profit by Region',
		]);
	});
});

describe('parse_tableau_workbook', () => {
	it('accepts XML and requires exactly one source', async () => {
		const context = {
			experimental_context: {} as ToolContext,
		} as Parameters<NonNullable<typeof parseTableauWorkbookTool.execute>>[1];
		const parsed = await parseTableauWorkbookTool.execute!({ workbook_xml: WORKBOOK_XML }, context);
		const invalid = await parseTableauWorkbookTool.execute!(
			{ workbook_xml: WORKBOOK_XML, workbook_base64: Buffer.from(WORKBOOK_XML).toString('base64') },
			context,
		);

		expect(parsed).toMatchObject({ success: true });
		expect(invalid).toMatchObject({ success: false, error: expect.stringContaining('exactly one') });
	});

	it('accepts a Tableau MCP temporary workbook download', async () => {
		const directory = path.join(os.tmpdir(), 'tableau-mcp-workbooks');
		const workbookPath = path.join(directory, `${randomUUID()}-fixture.twb`);
		await fs.mkdir(directory, { recursive: true });
		await fs.writeFile(workbookPath, WORKBOOK_XML);

		try {
			const context = {
				experimental_context: { projectFolder: os.tmpdir() } as ToolContext,
			} as Parameters<NonNullable<typeof parseTableauWorkbookTool.execute>>[1];
			const parsed = await parseTableauWorkbookTool.execute!({ file_path: workbookPath }, context);

			expect(parsed).toMatchObject({ success: true });
		} finally {
			await fs.unlink(workbookPath);
		}
	});
});
