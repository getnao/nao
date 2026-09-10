import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { findInternalSkill, internalSkillNames, listInternalSkills } from '../src/agents/skills';
import loadSkillTool from '../src/agents/tools/load-skill';

const bodyOf = (name: string, canRunSandbox: boolean): string => {
	return findInternalSkill(name)!.body({ canRunSandbox });
};

const runLoadSkill = async (name: string): Promise<{ name: string; body: string }> => {
	// A run with no agent settings has no sandbox, which is what the tool has to assume here.
	return (await loadSkillTool.execute!({ name }, { experimental_context: {}, toolCallId: 't', messages: [] })) as {
		name: string;
		body: string;
	};
};

describe('internal skill registry', () => {
	it('ships a skill for each file format the tools cannot simply read', () => {
		expect(internalSkillNames()).toEqual(
			expect.arrayContaining(['excel-handling', 'pdf-handling', 'metabase-dashboard-migration']),
		);
	});

	it('gives every skill a name, a description saying when to load it, and a body either way', () => {
		for (const skill of listInternalSkills()) {
			expect(skill.name).toMatch(/^[a-z0-9-]+$/);
			expect(skill.description.length).toBeGreaterThan(20);
			expect(skill.body({ canRunSandbox: true }).length).toBeGreaterThan(100);
			expect(skill.body({ canRunSandbox: false }).length).toBeGreaterThan(100);
		}
	});

	it('never mentions the sandbox in a run that has none', () => {
		for (const skill of listInternalSkills()) {
			expect(skill.body({ canRunSandbox: false })).not.toMatch(/sandbox|storage_files|save_files/i);
		}
	});

	it('keeps names unique, since the model addresses a skill by name', () => {
		expect(new Set(internalSkillNames()).size).toBe(internalSkillNames().length);
	});

	it('looks a skill up regardless of the casing and padding the model sends', () => {
		expect(findInternalSkill('  PDF-Handling ')?.name).toBe('pdf-handling');
	});

	it('does not resolve an unknown name', () => {
		expect(findInternalSkill('spreadsheets')).toBeUndefined();
	});
});

describe('load_skill tool', () => {
	it('returns the body of the requested skill', async () => {
		const output = await runLoadSkill('pdf-handling');

		expect(output.name).toBe('pdf-handling');
		expect(output.body).toContain('--- Page N ---');
	});

	it('leaves out the sandbox playbook when the run cannot run one', async () => {
		const output = await runLoadSkill('pdf-handling');

		expect(output.body).not.toContain('pdfplumber');
	});

	it('lists what is available when the name is wrong, so the model can correct itself', async () => {
		await expect(runLoadSkill('pdfs')).rejects.toThrow(/no built-in skill called 'pdfs'.*pdf-handling/s);
	});
});

describe('the pdf skill', () => {
	it('warns against transcribing a table instead of parsing it', () => {
		expect(bodyOf('pdf-handling', false)).toMatch(/never silently transcribe/i);
	});

	it('names the sandbox inputs the agent has to use to reach the file', () => {
		const body = bodyOf('pdf-handling', true);

		expect(body).toContain('storage_files');
		expect(body).toContain('pdfplumber');
	});

	it('tells the agent to check the page count against what it actually read', () => {
		expect(bodyOf('pdf-handling', false)).toMatch(/page count/i);
	});

	it('only offers OCR where there is something to run it in', () => {
		expect(bodyOf('pdf-handling', true)).toMatch(/OCR as a last resort/);
		expect(bodyOf('pdf-handling', false)).not.toMatch(/OCR/);
	});
});

describe('the excel skill', () => {
	it('sends the agent to read first, since that is what lists the sheets', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toMatch(/\*\*read\*\* gives you instead is its outline/);
		expect(body).toMatch(/never infer them/i);
	});

	it('offers the local database, naming the reader and the sheet argument', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toContain('read_xlsx');
		expect(body).toContain(LOCAL_DATABASE_ID);
		expect(body).toMatch(/sheet = 'FY26'/);
	});

	it('warns about the header row rather than assuming row 1', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toMatch(/header is rarely row 1/i);
		expect(body).toContain('range');
	});

	it('warns about the traps that silently corrupt a total', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toMatch(/merged cells/i);
		expect(body).toMatch(/double counts/i);
	});

	it('gives a SQL way through a messy sheet when there is no sandbox', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toContain('header = false');
		expect(body).toContain('IGNORE NULLS');
		expect(body).toContain('empty_as_varchar');
	});

	it('adds pandas and openpyxl only when a sandbox can run them', () => {
		const withSandbox = bodyOf('excel-handling', true);

		expect(withSandbox).toContain('storage_files');
		expect(withSandbox).toContain('openpyxl');
		expect(withSandbox).toMatch(/data_only=True/);
	});

	it('says how to write a workbook back out, since write only saves text', () => {
		expect(bodyOf('excel-handling', true)).toContain('ExcelWriter');
		expect(bodyOf('excel-handling', true)).toContain('save_files');
	});

	it('promises a CSV instead of a workbook when nothing can build one', () => {
		const body = bodyOf('excel-handling', false);

		expect(body).toMatch(/do not promise a workbook you cannot write/);
		expect(body).not.toContain('ExcelWriter');
	});

	it('names what to ask for when the file is the older .xls format', () => {
		expect(bodyOf('excel-handling', false)).toMatch(/pre-2007 format/);
		expect(bodyOf('excel-handling', true)).toContain('xlrd');
	});
});

describe('the Metabase dashboard migration skill', () => {
	it('reads every source card before it writes the target', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/read the complete dashboard first/i);
		expect(body).toMatch(/fetch every referenced saved question before creating or updating/i);
	});

	it('limits the first query path to parameterless native SQL and supported displays', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toContain('dataset_query.type');
		expect(body).toContain('dataset_query.native.query');
		expect(body).toContain('dataset_query.native.template-tags');
		expect(body).toMatch(/scalar.*line.*bar.*table/s);
		expect(body).toMatch(/never infer replacement SQL/i);
	});

	it('requires source and nao values to match before claiming verification', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/compare source and target column names, row counts, and values/i);
		expect(body).toMatch(/never claim visual or numeric equivalence/i);
	});

	it('keeps story queries refreshable from their original warehouse SQL', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/query_id.*warehouse execution/i);
		expect(body).toContain('duckdb_local');
		expect(body).toMatch(/never embed.*temporary.*query_\*/i);
	});

	it('preserves supported category wiring and reports date filters as unsupported', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toContain('string/=');
		expect(body).toContain('[[AND c.name = {{category}}]]');
		expect(body).toContain('{% filter category %} AND c.name IN ({{ filters.category.sql }}) {% endfilter %}');
		expect(body).toMatch(/date-range dashboard parameters are not currently supported/i);
		expect(body).toMatch(/do not emit.*date_range/i);
		expect(body).toMatch(/only to cards whose.*parameterMappings.*target the matching card/i);
		expect(body).toMatch(/never apply.*unwired card/i);
		expect(body).toMatch(/unfiltered story.*partial migration.*support is disabled/is);
	});

	it('compiles GUI-built MBQL through Metabase without inventing SQL', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toContain('dataset_query.query');
		expect(body).toContain('data.native_form.query');
		expect(body).toMatch(/execute that compiled SQL unchanged/i);
		expect(body).toMatch(/never recreate SQL from MBQL/i);
		expect(body).toMatch(/include its original MBQL in the imported item/i);
	});

	it('requires exact or reviewed reusable-object mappings', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/reuse an existing nao context table only when.*exact physical table or view/i);
		expect(body).toMatch(/never infer or write a business metric/i);
		expect(body).toMatch(/never create a segment or filter from an inferred label/i);
		expect(body).toMatch(/reused.*inlined.*review_required.*unsupported/s);
	});

	it('maps supported visualizations and reports unsupported behavior explicitly', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/bar.*stacked_bar.*stacked_bar_100.*stackable\.stack_type/s);
		expect(body).toMatch(/row.*horizontal_bar.*horizontal_bar_100/s);
		expect(body).toMatch(/area.*stacked_area.*stacked_area_100/s);
		expect(body).toMatch(/pie.*donut.*pie\.show_total/s);
		expect(body).toMatch(/combo.*mixed.*series_type.*y_axis/s);
		expect(body).toMatch(/display_map.*points.*scatter_bubble.*choropleth/s);
		expect(body).toMatch(/range rule.*color-scale.*single-value.*threshold/s);
		expect(body).toMatch(/skip funnel, gauge, progress, sankey/i);
	});

	it('creates a partial story without hiding skipped items or duplicating follow-ups', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toMatch(/never silently drop/i);
		expect(body).toMatch(/update or replace only the explicit story/i);
		expect(body).toMatch(/complete.*partial.*failed/s);
	});

	it('preserves virtual text, tab order, reading order, and relative grid widths', () => {
		const body = bodyOf('metabase-dashboard-migration', false);

		expect(body).toContain('visualization_settings.virtual_card.visualization_settings.text');
		expect(body).toMatch(/source tab in ascending position order/i);
		expect(body).toMatch(/row and then column/i);
		expect(body).toMatch(/smallest whole-number ratio/i);
		expect(body).toMatch(/only approximate Metabase.*fixed layout/i);
	});
});
