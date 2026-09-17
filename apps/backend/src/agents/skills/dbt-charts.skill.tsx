import { Block, Bold, Code, CodeBlock, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import { resolveStoryStyle } from '../../services/story-style';
import type { InternalSkill } from './types';

export const dbtChartsSkill: InternalSkill = {
	name: 'dbt-charts',
	description:
		'The dbt Charts YAML board syntax nao renders for stories with format="dbt_charts": board skeleton, queries and Jinja variables, the chart types and their fields, layout, and the mistakes the compiler rejects. Load this before creating or editing a dbt Charts board or dashboard.',
	isAvailable: ({ agentSettings }) => resolveStoryStyle(agentSettings) !== 'markdown',
	body: () =>
		renderToMarkdown(
			<Block>
				<Title level={1}>Writing dbt Charts boards</Title>
				<Span>
					A dbt Charts board is a single YAML document. In nao it is the <Code>code</Code> of a story created
					with <Code>format=&quot;dbt_charts&quot;</Code>; nao compiles it, runs every query through the
					project&apos;s own database connection, and renders the result to SVG in the story panel. The
					compiler is strict: every key is checked and unknown keys are errors, so write only what this skill
					describes.
				</Span>

				<Title level={2}>Workflow</Title>
				<List ordered>
					<ListItem>
						Check the columns you intend to use with <Bold>execute_sql</Bold> first. Board queries run on
						the same connection, so a query that works there works in the board. Never invent column names.
					</ListItem>
					<ListItem>
						Start with one query and one chart, create the story, and read <Code>template_warnings</Code> in
						the tool result: it carries the compile diagnostics (<Code>ERR-*</Code> must be fixed,{' '}
						<Code>WARN-*</Code> is advisory). Add charts once the board compiles cleanly.
					</ListItem>
					<ListItem>
						Edit with <Code>update</Code> (search and replace on the YAML text) or <Code>replace</Code>.
						Project boards found under the repository&apos;s <Code>charts/</Code> folder are read-only
						files; the user copies one into a story before it can be edited.
					</ListItem>
				</List>

				<Title level={2}>What nao supports</Title>
				<List>
					<ListItem>
						<Code>source:</Code> is the name of a nao database. Omit it when the project has a single
						database; name one only when several are configured. There is no <Code>dbt_charts.yml</Code>{' '}
						source registry and connection details never go in a board.
					</ListItem>
					<ListItem>
						Queries are SQL (<Code>type: sql</Code>, the default) or inline <Code>values</Code>. HTTP
						queries, CSV/JSON/Parquet file sources and <Code>schema</Code> queries are not available.
					</ListItem>
					<ListItem>
						<Code>{"{{ ref('model') }}"}</Code> and <Code>{"{{ source('src', 'table') }}"}</Code> resolve
						only when a synced repository contains a dbt <Code>target/manifest.json</Code>. Otherwise write
						the warehouse table name directly.
					</ListItem>
					<ListItem>
						Write SQL in the dialect of the database the board reads from, and keep the usual row-count
						discipline: aggregate in SQL, never rely on the chart to reduce the data.
					</ListItem>
				</List>

				<Title level={2}>Board skeleton</Title>
				<CodeBlock header='yaml'>
					{`title: Sales overview

variables:
  region:
    input: select
    label: Region
    options:
      static: [US, EU, APAC]
    default: US

queries:
  revenue: SELECT month, SUM(amount) AS total FROM orders GROUP BY 1 ORDER BY 1
  by_region:
    sql: |
      SELECT month, region, SUM(amount) AS total
      FROM orders
      WHERE {{ filter('region', region) }}
      GROUP BY 1, 2
      ORDER BY 1

charts:
  revenue_trend:
    query: revenue
    type: line
    title: Revenue
    x: month
    y: total
  region_split:
    query: by_region
    type: bar
    title: Revenue by region
    x: month
    y: total
    color: region
    style:
      stack: zero

rows:
  - revenue_trend
  - region_split`}
				</CodeBlock>
				<Span>
					Board properties sit at the YAML root: a top-level <Code>board:</Code> key is rejected. Top-level
					keys are <Code>title</Code>, <Code>notes</Code>, <Code>tags</Code>, <Code>source</Code>,{' '}
					<Code>variables</Code>, <Code>queries</Code>, <Code>charts</Code>, exactly one layout key (
					<Code>rows</Code>, <Code>cols</Code>, <Code>grid</Code> or <Code>tabs</Code>), and optionally{' '}
					<Code>theme</Code> (<Code>clarity</Code>, <Code>paper</Code>, <Code>neon</Code>).
				</Span>

				<Title level={2}>Queries</Title>
				<List>
					<ListItem>
						A bare string is SQL. The long form is{' '}
						<Code>{'{ sql: ..., source: ..., limit: ..., notes: ... }'}</Code>. Inline data:{' '}
						<Code>{'{ columns: [a, b], values: [[1, 2], [3, 4]] }'}</Code>.
					</ListItem>
					<ListItem>
						Multiline SQL always uses a block scalar (<Code>sql: |</Code>), never a quoted string with
						escaped newlines.
					</ListItem>
					<ListItem>
						Variables are referenced as bare names: <Code>{'{{ region }}'}</Code>, never{' '}
						<Code>{'{{ variables.region }}'}</Code>. A bare variable is bound as a query parameter, so
						arithmetic and casts belong in SQL around it (<Code>{'{{ months }} - 1'}</Code>);{' '}
						<Code>| int</Code> and <Code>| float</Code> raise.
					</ListItem>
					<ListItem>
						Filter with the macros: <Code>{"{{ filter('column', variable) }}"}</Code> emits <Code>=</Code>{' '}
						for a select and a quoted <Code>IN (...)</Code> for a multiselect;{' '}
						<Code>{"{{ filter_date_range('column', period) }}"}</Code> handles a daterange. Never build{' '}
						<Code>IN</Code> lists with <Code>tojson</Code>: the double quotes become column references and
						the query silently returns nothing.
					</ListItem>
					<ListItem>
						Selects show only the options you author. If a dashboard needs &quot;All&quot;, add it as a real
						option and handle it in the SQL.
					</ListItem>
				</List>

				<Title level={2}>Variables</Title>
				<Span>
					Each variable has an <Code>input</Code>: <Code>select</Code>, <Code>multiselect</Code>,{' '}
					<Code>radio</Code>, <Code>text</Code>, <Code>textarea</Code>, <Code>number</Code>,{' '}
					<Code>slider</Code>, <Code>range</Code>, <Code>date</Code>, <Code>daterange</Code> or{' '}
					<Code>checkbox</Code>. Common fields: <Code>label</Code>, <Code>default</Code>,{' '}
					<Code>placeholder</Code>, <Code>required</Code>, <Code>visible</Code>; sliders take <Code>min</Code>
					, <Code>max</Code>, <Code>step</Code>.
				</Span>
				<CodeBlock header='yaml'>
					{`variables:
  status:
    input: multiselect
    options: { static: [completed, returned] }
  customer:
    input: select
    options: { query: customer_options, column: customer_name }
  segment:
    input: select
    column: orders.segment        # options read from a table column
  period:
    input: daterange
  min_amount:
    input: slider
    min: 0
    max: 1000
    step: 50
    default: 100`}
				</CodeBlock>
				<Span>
					Rejected shapes: a bare list (<Code>options: [a, b]</Code>) or <Code>options.values</Code> instead
					of <Code>options.static</Code>, and <Code>default</Code> nested under <Code>options</Code>.
				</Span>

				<Title level={2}>Charts</Title>
				<Span>
					A chart binds a <Code>query</Code> (a name, or a bare SQL string for a one-off) to a{' '}
					<Code>type</Code> and channels. Shared fields: <Code>title</Code>, <Code>subtitle</Code>,{' '}
					<Code>x</Code>, <Code>y</Code> (a column or a list for multi-series), <Code>color</Code> (a bare
					column name), <Code>size</Code>, <Code>sort: {'{ by, order }'}</Code>, <Code>x_label</Code>,{' '}
					<Code>y_label</Code>, <Code>height</Code> and <Code>aspect_ratio</Code> at the chart root, and{' '}
					<Code>style</Code> for paint only.
				</Span>
				<CodeBlock header='yaml'>
					{`# bar — style.orientation: vertical | horizontal; style.stack: none | zero | normalize | center
type: bar
x: category
y: value
color: group

# line / area — same encoding; area stacks by color with style.stack
type: line
x: date
y: [revenue, target]

# scatter
type: scatter
x: spend
y: revenue
size: volume

# pie / donut — one row per slice
type: pie
theta: revenue
color: segment

# kpi — the query must return exactly one row; uses label, not title
type: kpi
value: total_revenue
label: Total revenue
style:
  value:
    format: currency_whole
support:
  value: growth
  label: vs last month
  format: percent_delta
  tone: positive

# table — every query column, in query order
type: table
style:
  columns:
    amount: { label: Amount, format: currency_whole, align: right }
    order_id: { visible: false }

# heatmap — one row per (x, y) cell
type: heatmap
x: day_of_week
y: hour
color: event_count

# histogram
type: histogram
x: amount`}
				</CodeBlock>
				<List>
					<ListItem>
						Named shapes are recipes, not types: stacked bar is <Code>bar</Code> with <Code>color</Code> and{' '}
						<Code>style.stack: zero</Code>; 100% stacked uses <Code>stack: normalize</Code>; a combo or
						dual-axis chart is a <Code>bar</Code>/<Code>line</Code>/<Code>area</Code> with{' '}
						<Code>layers: [{'{ type: line, y: target, axis_y: { position: right } }'}]</Code>; small
						multiples use <Code>multiples: {'{ columns: region }'}</Code>.
					</ListItem>
					<ListItem>
						Not drawable: funnel, gauge, sankey, treemap, waterfall, radar, sunburst. Say so and offer the
						closest recipe instead of guessing a <Code>type</Code>.
					</ListItem>
					<ListItem>
						Number formats are D3 strings or aliases (<Code>integer</Code>, <Code>number</Code>,{' '}
						<Code>currency</Code>, <Code>currency_whole</Code>, <Code>percent</Code>,{' '}
						<Code>percent_delta</Code>). <Code>percent</Code> multiplies by 100; use{' '}
						<Code>percent_number</Code> for a value that already is a percentage. On cartesian charts the
						measure format lives at <Code>style.number_format</Code>, dates at{' '}
						<Code>style.time_format</Code>; a chart-root <Code>format</Code> key is rejected.
					</ListItem>
				</List>

				<Title level={2}>Layout</Title>
				<CodeBlock header='yaml'>
					{`rows:
  - cols: [kpi_revenue, kpi_orders, kpi_customers]
  - text: |
      ## Trend
      Revenue has grown every month since Q2.
  - revenue_trend
  - cols:
      - width: "70%"
        rows: [region_split]
      - width: "30%"
        rows: [top_customers]

tabs:
  items:
    - title: Overview
      rows: [kpi_revenue, revenue_trend]
    - title: Details
      rows: [orders_table]`}
				</CodeBlock>
				<Span>
					Entries are chart names, <Code>text</Code> markdown blocks, or nested sections with their own{' '}
					<Code>rows</Code>/<Code>cols</Code>, <Code>title</Code> and <Code>width</Code>. A row can also carry
					a full inline chart under its own key. Use <Code>visible: variable_name</Code> on an entry to hide
					it when a checkbox variable is off.
				</Span>
			</Block>,
		),
};
