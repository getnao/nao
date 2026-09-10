import { Block, Bold, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import type { InternalSkill } from './types';

export const metabaseDashboardMigrationSkill: InternalSkill = {
	name: 'metabase-dashboard-migration',
	description:
		'How to import or recreate a Metabase dashboard or collection as a nao story, preserve native SQL and supported visualizations, verify the numbers, report every unsupported item, and update the same story on follow-up requests. Load this for any Metabase migration request.',
	body: () =>
		renderToMarkdown(
			<Block>
				<Title level={1}>Migrate a Metabase dashboard to a nao story</Title>
				<Span>
					Treat this as a read, reproduce, and verify workflow. Metabase is the read-only source. nao owns the
					executed queries and target story. Never call a Metabase create, update, archive, or delete tool
					during a migration.
				</Span>

				<Title level={2}>Resolve the source before writing</Title>
				<List ordered>
					<ListItem>
						Find the configured Metabase server under <Code>/agent/mcps</Code>. If its tool folder is empty,
						call <Bold>mcp_connect</Bold>, then read the relevant tool schemas before using{' '}
						<Bold>mcp_call</Bold>. If several Metabase servers are configured and the user did not identify
						one, ask one clarification.
					</ListItem>
					<ListItem>
						Resolve a dashboard URL by its numeric dashboard ID. Resolve an ID directly. Resolve a name by
						listing dashboards and require exactly one case-insensitive match; never pick one of several
						same-name dashboards.
					</ListItem>
					<ListItem>
						Read the complete dashboard first. Fetch every referenced saved question before creating or
						updating a story. Keep dashboard-card IDs, question IDs, titles, descriptions, positions,
						display types, visualization settings, parameters, and parameter mappings.
					</ListItem>
					<ListItem>
						List Metabase databases and map each source database ID to one nao database ID. Match only when
						the configured source is unambiguous. If it is not, ask the user rather than testing SQL against
						a guessed database.
					</ListItem>
				</List>

				<Title level={2}>Classify every dashboard item</Title>
				<Span>The first supported query path has all of these properties:</Span>
				<List>
					<ListItem>
						<Code>dataset_query.type</Code> is <Code>native</Code>.
					</ListItem>
					<ListItem>
						<Code>dataset_query.native.query</Code> contains the source SQL.
					</ListItem>
					<ListItem>
						<Code>dataset_query.native.template-tags</Code> is absent or empty, and the dashboard card has
						no parameter mappings.
					</ListItem>
					<ListItem>
						The display is <Code>scalar</Code>, <Code>smartscalar</Code>, <Code>line</Code>,{' '}
						<Code>bar</Code>, <Code>row</Code>, <Code>area</Code>, <Code>pie</Code>, <Code>combo</Code>,{' '}
						<Code>scatter</Code>, <Code>table</Code>, or <Code>map</Code>.
					</ListItem>
				</List>
				<Span>
					Preserve each virtual text card&apos;s{' '}
					<Code>visualization_settings.virtual_card.visualization_settings.text</Code> as markdown. Mark
					unsupported native templates and every unsupported display type with its source question ID, title,
					and exact reason. A skipped item does not block supported items. Never infer replacement SQL from
					chart labels, and never silently drop an item.
				</Span>

				<Title level={2}>Translate supported dashboard filters</Title>
				<List>
					<ListItem>
						Enable filter migration only when the story tool documents <Code>{'<filter>'}</Code> support. If
						it does not, remove Metabase optional template blocks, create an unfiltered story, and report a
						partial migration. Never emit filter tags or nao SQL templates when support is disabled.
					</ListItem>
					<ListItem>
						The first supported mapping is an optional <Code>string/=</Code> dashboard parameter wired by{' '}
						<Code>[&quot;variable&quot;, [&quot;template-tag&quot;, &quot;name&quot;]]</Code> to a native
						text template tag used in an optional equality clause such as{' '}
						<Code>{'[[AND c.name = {{category}}]]'}</Code>.
					</ListItem>
					<ListItem>
						Date-range dashboard parameters are not currently supported. Remove their optional Metabase
						template clauses to keep the affected card unfiltered, report the skipped filter and card
						wiring, and mark the migration partial. Do not emit a nao <Code>date_range</Code> filter.
					</ListItem>
					<ListItem>
						Create exactly one nao <Code>select</Code> filter for each supported dashboard parameter. Derive
						its table and column option source from the unambiguous SQL relation and mapped nao database.
						Use hardcoded options only when Metabase supplies a complete explicit option list. nao does not
						preserve Metabase defaults or required behavior, so keep the filter optional and report either
						behavior as an approximation when present.
					</ListItem>
					<ListItem>
						Replace only the mapped optional equality clause with{' '}
						<Code>
							{'{% filter category %} AND c.name IN ({{ filters.category.sql }}) {% endfilter %}'}
						</Code>
						. Add that block only to cards whose <Code>parameterMappings</Code> target the matching card and
						template tag. Never apply a dashboard parameter to an unwired card.
					</ListItem>
					<ListItem>
						Declare each filter once, before the first affected block; in a tabbed story place declarations
						at the start of the first tab. Validate the story and every translated SQL template before
						creating or updating it.
					</ListItem>
				</List>

				<Title level={2}>Compile GUI-built queries</Title>
				<List>
					<ListItem>
						For a card whose <Code>dataset_query.type</Code> is <Code>query</Code>, retain its complete{' '}
						<Code>dataset_query.query</Code> object as the original MBQL. Ask Metabase to execute or compile
						the saved question and use only the SQL returned in <Code>data.native_form.query</Code>.
					</ListItem>
					<ListItem>
						Execute that compiled SQL unchanged through nao <Bold>execute_sql</Bold> against the mapped
						database. Never recreate SQL from MBQL fields, chart labels, or result columns. If Metabase does
						not return compiled SQL, skip the card with that exact reason.
					</ListItem>
					<ListItem>
						Report the card as compiled and inlined, include its original MBQL in the imported item, and
						compare the Metabase rows with the nao execution exactly like native SQL. Do not promote models,
						metrics, or segments when the source question contains no explicit reusable-object reference.
					</ListItem>
				</List>

				<Title level={2}>Preserve reusable models, metrics, and segments</Title>
				<List>
					<ListItem>
						Inspect each card&apos;s <Code>type</Code> and <Code>referencedObjects</Code> before compiling
						it. Fetch every referenced <Code>card</Code> and confirm whether it is a model. Read the source
						database metadata for referenced segment or legacy metric IDs when that Metabase tool is
						available. An ID or display name alone is never evidence of semantic equivalence.
					</ListItem>
					<ListItem>
						For a model-backed card, execute the SQL compiled by Metabase first. Reuse an existing nao
						context table only when the model resolves to that exact physical table or view. Otherwise keep
						the compiled model SQL inline, report the model as <Code>inlined</Code>, and offer any reusable
						context definition for user review instead of writing it.
					</ListItem>
					<ListItem>
						For a <Code>metric</Code> card or explicit metric reference, preserve its numeric behavior with
						Metabase-compiled SQL. Mark it <Code>reused</Code> only when an existing nao semantic metric has
						the same explicit source definition. Otherwise mark it <Code>review_required</Code>, execute the
						compiled SQL inline, and put the proposed semantic definition only in the report. Never infer or
						write a business metric from its name, labels, or output column.
					</ListItem>
					<ListItem>
						For an explicit segment reference, preserve its compiled predicate. Reuse an existing nao filter
						only when its explicit definition is equivalent. Otherwise execute the compiled predicate inline
						and report both <Code>inlined</Code> and the loss of reusable segment semantics. Never create a
						segment or filter from an inferred label.
					</ListItem>
					<ListItem>
						If a referenced definition cannot be read, inline only the SQL returned by Metabase and mark the
						reusable mapping <Code>unsupported</Code>; do not claim reuse. Verify model rows and metric or
						segment values against Metabase, including representative filter or date combinations when the
						source object accepts them.
					</ListItem>
				</List>

				<Title level={2}>Execute and compare</Title>
				<List ordered>
					<ListItem>
						Execute each supported saved question through the Metabase MCP and retain its returned columns
						and rows as the source result.
					</ListItem>
					<ListItem>
						Copy parameterless native SQL exactly into <Bold>execute_sql</Bold> using the mapped nao
						database ID. For the supported filter path, change only the mapped optional equality clause to
						its nao filter block. Do not copy Metabase result rows into the story. The target block must use
						the <Code>query_id</Code> returned by that warehouse execution. Never execute target story
						queries against <Code>duckdb_local</Code>, and never embed a query whose SQL reads from a
						temporary <Code>query_*</Code> result.
					</ListItem>
					<ListItem>
						Compare source and target column names, row counts, and values. Normalize decimal
						representations and equivalent ISO timestamps before comparison, but do not round away a real
						difference. Preserve row order when the query orders its results; otherwise compare rows
						order-independently.
					</ListItem>
					<ListItem>
						For each supported dashboard filter, compare at least one selected value on every wired card.
						Also verify that the same selection does not change unwired cards.
					</ListItem>
					<ListItem>
						If execution or comparison fails, correct a clear database mapping or serialization mistake and
						retry once. Do not rewrite valid source SQL to manufacture a match. A card that still differs is
						unverified and makes the migration partial.
					</ListItem>
				</List>

				<Title level={2}>Build the supported story</Title>
				<List>
					<ListItem>
						Map <Code>scalar</Code> to <Code>kpi_card</Code> and <Code>line</Code> to <Code>line</Code>. Map{' '}
						<Code>smartscalar</Code> to <Code>kpi_card</Code> with its comparison mode only when the result
						contains compatible time-ordered periods; otherwise omit the comparison and report it.
					</ListItem>
					<ListItem>
						Map <Code>bar</Code> to <Code>bar</Code>, <Code>stacked_bar</Code>, or{' '}
						<Code>stacked_bar_100</Code> from <Code>stackable.stack_type</Code>. Map Metabase{' '}
						<Code>row</Code> the same way to <Code>horizontal_bar</Code> or <Code>horizontal_bar_100</Code>.
						Map <Code>area</Code> to <Code>area</Code>, <Code>stacked_area</Code>, or{' '}
						<Code>stacked_area_100</Code>. Use normalized types only for an explicit <Code>normalized</Code>{' '}
						setting, never from values that merely look like percentages.
					</ListItem>
					<ListItem>
						Map <Code>pie</Code> to <Code>donut</Code> when <Code>pie.show_total</Code> is true, otherwise
						to <Code>pie</Code>. Map <Code>combo</Code> to <Code>mixed</Code> and preserve each explicit
						series display as <Code>series_type</Code> plus its left or right <Code>y_axis</Code>. Map{' '}
						<Code>scatter</Code> to <Code>scatter</Code> only when the source identifies numeric X and Y
						columns.
					</ListItem>
					<ListItem>
						Derive axis and series keys from the nao query result columns. Use Metabase visualization
						settings only for supported labels and formatting; never use them as evidence that a result
						column exists. Preserve explicit series labels, CSS colors, axis titles and bounds, and{' '}
						<Code>graph.show_values</Code>. Use <Code>date</Code> for the nao X-axis only when the result
						contains parseable dates, <Code>number</Code> for numeric scatter axes, and{' '}
						<Code>category</Code> otherwise.
					</ListItem>
					<ListItem>
						Translate explicit currency, decimal precision, compact notation, prefix, and suffix settings to
						each nao series <Code>value_format</Code>. Preserve percent suffixes only when source values are
						already percentage units; if Metabase scales fractional values for display, report the
						formatting as unsupported instead of changing the SQL. Report untranslatable locale separators,
						scaling, or date formats.
					</ListItem>
					<ListItem>
						Map <Code>table</Code> to <Code>display_chart</Code> with <Code>chart_type: table</Code>.
						Translate an explicit Metabase range rule to a nao <Code>color-scale</Code> and an equivalent
						single-value numeric rule to a nao <Code>threshold</Code>. Report row highlighting, mini-bars,
						reordered or hidden columns, and every conditional rule that has no exact nao equivalent.
					</ListItem>
					<ListItem>
						Map a pin <Code>map</Code> with valid latitude and longitude result columns through{' '}
						<Bold>display_map</Bold> as <Code>points</Code>, or as <Code>scatter_bubble</Code> when an
						explicit numeric metric controls marker size. Map a region map to <Code>choropleth</Code> only
						when its keys match a supported boundary set. Never fabricate coordinates, centroids, or
						boundaries.
					</ListItem>
					<ListItem>
						A pivot may become a flat table only when the returned columns stay understandable. Otherwise
						skip it. Skip funnel, gauge, progress, sankey, custom JavaScript, drill-through, click actions,
						and navigation unless the user explicitly accepts a named approximation; report every skipped or
						approximated behavior.
					</ListItem>
					<ListItem>
						Call <Bold>display_chart</Bold> for every chart or table and <Bold>display_map</Bold> for every
						map before embedding it. Use the same configuration and nao <Code>query_id</Code> in the story
						block.
					</ListItem>
					<ListItem>
						If the dashboard has tabs, emit one consecutive <Code>{'<tab title="...">'}</Code> block per
						source tab in ascending position order. Put every item inside its source tab and leave no
						content outside the tab blocks.
					</ListItem>
					<ListItem>
						Within each tab, sort content by dashboard row and then column. Put two to four compatible items
						from the same row in a story grid. Prefer reading order to pixel geometry.
					</ListItem>
					<ListItem>
						For unequal same-row widths, reduce the source <Code>size_x</Code> values to their smallest
						whole-number ratio and use it as the grid <Code>widths</Code>. Omit <Code>widths</Code> when
						columns are equal, and report that responsive story grids only approximate Metabase&apos;s fixed
						layout.
					</ListItem>
					<ListItem>
						Use the dashboard name as the story title and preserve dashboard, card, and text descriptions as
						markdown where they add context.
					</ListItem>
				</List>

				<Title level={2}>Create once, update explicitly</Title>
				<Span>
					On the first migration, create one story with a stable slug and return that story ID. On a
					follow-up, update or replace only the explicit story from the prior migration in this chat or the ID
					supplied by the user. Never search by title and create a duplicate when an explicit target exists.
					Validate the complete story returned by the story tool and fix any template warnings before
					finishing.
				</Span>

				<Title level={2}>Migration report</Title>
				<Span>End both the story and the answer with a report containing:</Span>
				<List>
					<ListItem>the source collection, dashboard name, and dashboard ID;</ListItem>
					<ListItem>the target story ID and title;</ListItem>
					<ListItem>
						every imported question with its source ID, nao query ID, target visualization type,
						verification, and original MBQL when it was GUI-built;
					</ListItem>
					<ListItem>
						every source model, metric, and segment ID with a mapping mode of <Code>reused</Code>,{' '}
						<Code>inlined</Code>, <Code>review_required</Code>, or <Code>unsupported</Code>, plus the exact
						source definition used to justify reuse or the reason reuse was not possible;
					</ListItem>
					<ListItem>every skipped item and behavior with its exact reason;</ListItem>
					<ListItem>layout or formatting approximations and missing database mappings;</ListItem>
					<ListItem>
						a status of <Code>complete</Code>, <Code>partial</Code>, or <Code>failed</Code>.
					</ListItem>
				</List>
				<Span>
					Use <Code>complete</Code> only when every source item has a supported faithful mapping and all
					comparisons pass. Use <Code>partial</Code> when a valid story exists but anything was skipped,
					approximated, or not verified. Use <Code>failed</Code> only when no valid target story was created.
					Never claim visual or numeric equivalence without the corresponding checks.
				</Span>
			</Block>,
		),
};
