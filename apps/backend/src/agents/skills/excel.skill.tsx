import {
	Block,
	Bold,
	Code,
	CodeBlock,
	Italic,
	List,
	ListItem,
	renderToMarkdown,
	Span,
	Title,
} from '../../lib/markdown';
import type { InternalSkill } from './types';

export const excelSkill: InternalSkill = {
	name: 'excel-handling',
	description:
		'How to get trustworthy numbers out of an .xlsx workbook: listing its sheets, finding the real header row, merged cells, formulas with no cached value, and totals rows that double count. Load this before working with a spreadsheet.',
	body: ({ canRunSandbox }) =>
		renderToMarkdown(
			<Block>
				<Title level={1}>Working with Excel workbooks</Title>
				<Span>
					A workbook is a zip archive of XML, so its cells never arrive as text. What <Bold>read</Bold> gives
					you instead is its outline: every sheet in tab order, which of them are hidden, and the used range
					and row and column counts of each. Start there on every workbook. It is one cheap call, and it is
					the only way to know which sheets exist — never infer them, or what they hold, from the file name.
				</Span>
				{canRunSandbox ? (
					<>
						<Span>Then read the data itself with the tool that suits the sheet.</Span>
						<List>
							<ListItem>
								<Bold>execute_sql</Bold> against the local database reads a sheet in place with{' '}
								<Code>read_xlsx</Code>, mounting nothing. This is the main route, and the only one when
								the answer involves joining the sheet to warehouse data. It is DuckDB, so write DuckDB
								SQL.
							</ListItem>
							<ListItem>
								<Bold>execute_sandboxed_code</Bold> with the file mounted through{' '}
								<Code>storage_files</Code> gives you pandas and openpyxl. Reach for it when a sheet is
								too irregular to describe as a range: stacked tables, merged headers two rows deep, a
								grid that has to be reshaped before it means anything.
							</ListItem>
						</List>
					</>
				) : (
					<Span>
						Then read the data itself with <Bold>execute_sql</Bold> against the local database, which reads
						a sheet in place with <Code>read_xlsx</Code> and mounts nothing. It is the only route you have
						here, and the right one whenever the answer involves joining the sheet to warehouse data. It is
						DuckDB, so write DuckDB SQL.
					</Span>
				)}
				<Span>
					All of that is <Code>.xlsx</Code> only. <Code>.xls</Code>, the pre-2007 format, is a different
					format that none of these readers open
					{canRunSandbox && (
						<>
							{' '}
							unless the sandbox installs <Code>xlrd</Code>
						</>
					)}
					: ask for it as <Code>.xlsx</Code> or CSV.
				</Span>

				<Title level={2}>Reading a sheet in SQL</Title>
				<Span>
					<Code>read_xlsx</Code> takes the first sheet unless told otherwise, and infers both the used range
					and whether its first row is a header. Name the sheet explicitly, every time, using a name from the
					outline — a name you guessed will simply fail.
				</Span>
				<CodeBlock header='sql'>
					{`-- database_id: duckdb_local
SELECT * FROM read_xlsx('/home/uploads/2026-01-31/budget.xlsx', sheet = 'FY26') LIMIT 20`}
				</CodeBlock>
				<Span>
					Two signs it inferred the shape wrongly: columns named <Code>A1</Code>, <Code>B1</Code>… mean it
					found no header row, and a column that is all <Code>NULL</Code> where the sheet clearly has values
					means the range is not the one you wanted.
				</Span>

				<Title level={2}>Look at the grid before you load it</Title>
				<Span>
					The single biggest source of wrong answers from a spreadsheet is loading it as if it were a CSV.
					Print the top-left corner raw first — no header, no type inference — so you can see where the table
					actually starts.
				</Span>
				<CodeBlock header='sql'>
					{`-- database_id: duckdb_local
SELECT * FROM read_xlsx(
    '/home/uploads/2026-01-31/budget.xlsx',
    sheet = 'FY26', range = 'A1:H15', header = false, all_varchar = true
)`}
				</CodeBlock>
				<Span>
					Once you can see it, read the table with the range and header you decided on, and use the options
					for what the sheet actually contains: <Code>range</Code> to skip a title block or stop before a
					totals block, <Code>header = true</Code> once the first row of the range is the header,{' '}
					<Code>empty_as_varchar</Code> when a column starts with blanks, <Code>ignore_errors</Code> when a
					few cells cannot be cast, and <Code>all_varchar</Code> when you would rather cast everything
					yourself.
				</Span>
				<CodeBlock header='sql'>
					{`-- database_id: duckdb_local
SELECT * FROM read_xlsx(
    '/home/uploads/2026-01-31/budget.xlsx',
    sheet = 'FY26', range = 'A4:N412', header = true
)`}
				</CodeBlock>
				{canRunSandbox && (
					<>
						<Span>
							In the sandbox the same look costs one <Code>print</Code>, and gives you the whole grid to
							reshape:
						</Span>
						<CodeBlock>
							{`storage_files: ["/home/uploads/2026-01-31/budget.xlsx"]
packages: ["pandas", "openpyxl"]`}
						</CodeBlock>
						<CodeBlock header='python'>
							{`import pandas as pd

path = "files/uploads/2026-01-31/budget.xlsx"
print(pd.read_excel(path, sheet_name="FY26", header=None, nrows=12).to_string())`}
						</CodeBlock>
					</>
				)}

				<Title level={2}>What that first look is checking for</Title>
				<List>
					<ListItem>
						<Bold>More sheets than you were told about.</Bold> The first sheet is often a cover page, notes,
						or last year's version, and a hidden sheet is usually the working copy nobody meant to ship. If
						several sheets could answer the question, ask which one rather than picking.
					</ListItem>
					<ListItem>
						<Bold>The header is rarely row 1.</Bold> Titles, logos and blank spacer rows push it down, and a
						report title read as column names turns every real row into data. Pass{' '}
						{canRunSandbox ? (
							<>
								<Code>range</Code> (or <Code>skiprows</Code> in pandas)
							</>
						) : (
							<Code>range</Code>
						)}{' '}
						once you have seen where the table starts.
					</ListItem>
					<ListItem>
						<Bold>Merged cells read as empty.</Bold> Only the top-left cell of a merge holds the value, so a
						grouping column that looks filled in Excel arrives mostly <Code>NULL</Code>. Carry it down
						explicitly
						{canRunSandbox && (
							<>
								{' '}
								(<Code>ffill()</Code> in pandas, or the SQL below)
							</>
						)}
						, and confirm the result against the grid you printed.
					</ListItem>
					<ListItem>
						<Bold>Totals rows sitting inside the data.</Bold> A <Code>Total</Code> or <Code>Subtotal</Code>{' '}
						row is just another row, so summing the column double counts. Exclude them before you aggregate
						— and if your total disagrees with the one in the sheet, say so rather than quietly publishing
						yours.
					</ListItem>
					<ListItem>
						<Bold>Hidden rows, columns and active filters.</Bold> What the user sees is not what the file
						contains. If your row count does not match what they expect, this is usually why.
					</ListItem>
				</List>
				<Span>Filling a merged grouping column down, in SQL:</Span>
				<CodeBlock header='sql'>
					{`WITH sheet AS (
    SELECT row_number() OVER () AS sheet_row, * FROM read_xlsx('...', sheet = 'FY26')
)
SELECT last_value(region IGNORE NULLS) OVER (ORDER BY sheet_row) AS region, amount FROM sheet`}
				</CodeBlock>

				<Title level={2}>Formulas may have no value</Title>
				<Span>
					Cells hold a formula and, separately, the value Excel last cached for it. Every reader here returns
					the cached value, which is what you want — but a workbook written by a script and never opened in
					Excel has nothing cached, so those cells arrive empty. The column is not empty, it is uncomputed:
					say so, and do not treat the gaps as zeros.
					{canRunSandbox && (
						<>
							{' '}
							Reading with <Code>openpyxl</Code> directly gives you formula strings such as{' '}
							<Code>=SUM(B2:B13)</Code> unless you pass <Code>data_only=True</Code>; an <Code>=</Code> in
							your output means you are looking at the formula, not the number.
						</>
					)}
				</Span>

				<Title level={2}>Types are not what they look like</Title>
				<Span>
					Excel stores a date as a serial number and a hand-typed figure as whatever the typist produced, so a
					column is only as clean as the person who filled it. Dates can arrive as integers, numbers as
					strings with thousands separators, currency symbols or a decimal comma, and IDs can lose their
					leading zeros. Read the column as text and convert it yourself when it looks like that — with{' '}
					{canRunSandbox ? (
						<>
							<Code>pd.to_numeric(errors=&quot;coerce&quot;)</Code> and <Code>pd.to_datetime</Code>, or{' '}
							<Code>TRY_CAST</Code> and <Code>strptime</Code> in SQL
						</>
					) : (
						<>
							<Code>TRY_CAST</Code>, <Code>replace</Code> and <Code>strptime</Code>
						</>
					)}{' '}
					— then count what failed to convert. A silently dropped value is a dropped row in every total that
					follows.
				</Span>

				<Title level={2}>Keep the workbook out of the conversation</Title>
				<Span>
					A sheet can hold hundreds of thousands of rows. Aggregate where the data is and return only what you
					need — a handful of rows, or the figure you were asked for. Never <Italic>select</Italic> a whole
					sheet to get it into your context: it will be truncated somewhere arbitrary, and you will reason
					over half a table without knowing it.
				</Span>
				<Title level={2}>Reporting back</Title>
				<Span>
					Name the sheet and the header row you used (&quot;from the <Code>FY26</Code> sheet, taking row 4 as
					the header&quot;). A spreadsheet almost always needed a judgement call to read, and stating yours is
					what lets the user catch it if you chose wrong.
				</Span>

				<Title level={2}>Producing a workbook</Title>
				{canRunSandbox ? (
					<>
						<Span>
							<Bold>write</Bold> saves text only, so it cannot make an <Code>.xlsx</Code>. Build one in
							the sandbox instead: write it into <Code>out/</Code> and name it in <Code>save_files</Code>,
							which keeps it under /home where the user can download it. Give them the path you saved it
							to.
						</Span>
						<CodeBlock>{`save_files: [{ filename: "fy26-summary.xlsx", home_path: "/home/exports/fy26-summary.xlsx" }]`}</CodeBlock>
						<CodeBlock header='python'>
							{`with pd.ExcelWriter("out/fy26-summary.xlsx") as writer:
    summary.to_excel(writer, sheet_name="Summary", index=False)
    detail.to_excel(writer, sheet_name="Detail", index=False)`}
						</CodeBlock>
						<Span>
							A CSV is still the better answer when the user only needs the numbers — say that it is a CSV
							they can open in Excel.
						</Span>
					</>
				) : (
					<Span>
						<Bold>write</Bold> saves text only, and nothing available here can produce a binary{' '}
						<Code>.xlsx</Code>. Save a CSV under <Bold>/home</Bold> instead, tell the user the path and that
						it opens in Excel, and do not promise a workbook you cannot write.
					</Span>
				)}
			</Block>,
		),
};
