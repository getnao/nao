import { Block, Bold, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import type { InternalSkill } from './types';

export const forecastingSkill: InternalSkill = {
	name: 'forecasting',
	description:
		'Forecast a time series with t0-beta through a configured Retrocast MCP server: select or upload data, inspect its columns, forecast with uncertainty, and evaluate on historical cutoffs. Load before forecasting future values; requires a Retrocast MCP connection.',
	body: ({ canRunSandbox }) =>
		renderToMarkdown(
			<Block>
				<Title level={1}>Forecasting with Retrocast</Title>
				<Span>
					Use the configured Retrocast MCP server for inference. It runs against the connected user&apos;s
					Retrocast workspace. Forecasting requires a Retrocast account; backtesting may require a paid plan.
					The setup guide is in nao&apos;s <Code>docs/retrocast-forecasting.md</Code> and the server
					documentation is at https://docs.retrocast.com/mcp.
				</Span>
				<Title level={2}>Connect and discover</Title>
				<Span>
					Find the configured server name under <Code>/agent/mcps/</Code>; the setup example names it{' '}
					<Code>retrocast</Code>. If it is not configured, explain the setup requirement. If its tool folder
					is empty, call <Bold>mcp_connect</Bold>. On <Code>AUTH_REQUIRED</Code>, ask the user to connect with
					the displayed Connect button and wait. Read each tool&apos;s discovered JSON schema before calling{' '}
					<Bold>mcp_call</Bold>; do not guess argument shapes or reuse REST API examples.
				</Span>
				<Title level={2}>Choose the series</Title>
				<Span>
					Establish the target metric, time grain, horizon, and any dimensions to pin or aggregate. Use the
					user&apos;s existing Retrocast dataset when supplied; otherwise discover it with{' '}
					<Code>list_datasets</Code>. Inspect <Code>get_dataset</Code> and <Code>get_dataset_columns</Code>,
					then check values with <Code>query_timeseries</Code>. Verify the timestamp and numeric target
					columns rather than accepting suggested roles blindly. Check gaps, duplicate timestamps, and
					aggregation; never silently turn missing values into zeros.
				</Span>
				{canRunSandbox ? (
					<Block>
						<Title level={2}>Upload warehouse results or a saved file</Title>
						<Span>
							Query the full history at the chosen grain using <Bold>execute_sql</Bold> or{' '}
							<Bold>execute_semantic_query</Bold>. Avoid preview limits: the model sees only a preview,
							but <Bold>execute_sandboxed_code</Bold> can mount the full query result through{' '}
							<Code>data_files</Code> using its query ID. Use <Code>storage_files</Code> for an existing
							CSV or Parquet under /home. Upload only the columns needed for the forecast.
						</Span>
						<List ordered>
							<ListItem>
								Call <Code>upload_dataset</Code> with the CSV or Parquet filename and format. The hosted
								server cannot read nao&apos;s filesystem: it returns a <Code>dataset_id</Code> and an{' '}
								<Code>upload_target</Code>.
							</ListItem>
							<ListItem>
								In the sandbox, PUT the file bytes to the returned URL with the returned headers. Use an
								HTTP timeout and check the response status before continuing. Do not print the presigned
								URL or send it to a different service. Keep the sandbox ID if subsequent steps need the
								same file.
							</ListItem>
							<ListItem>
								Only after a successful PUT, call <Code>confirm_dataset_upload</Code> with the returned
								dataset ID and any column roles used for the upload. Verify readiness and inspect
								columns before forecasting. A failed transfer is not a ready dataset.
							</ListItem>
						</List>
					</Block>
				) : (
					<Span>
						For data that is only in nao, have the user upload a CSV or Parquet to Retrocast and provide the
						dataset ID, or use <Code>create_dataset_from_link</Code> with a supplied reachable presigned
						Parquet URL. A /home file path is not a remotely reachable URL. The available tools cannot PUT a
						local file to the hosted upload target.
					</Span>
				)}
				<Title level={2}>Forecast and evaluate</Title>
				<Span>
					Call <Code>create_forecast</Code> with <Code>model: t0-beta</Code> explicitly, the dataset ID,
					verified datetime and target columns, frequency, horizon, and quantiles <Code>[0.1, 0.5, 0.9]</Code>{' '}
					for a median and an 80% prediction interval. If t0-beta is unavailable, report that rather than
					silently substituting a model. Use historical covariates only through the supported tool arguments;
					known-future covariates must really be available at the forecast cutoff. Check any skipped-covariate
					notices.
				</Span>
				<Span>
					When the user needs an accuracy assessment and their plan supports it, call{' '}
					<Code>run_backtest</Code> with the same model, grain, horizon, and series scope at historical
					cutoffs. Keep forecast inputs before each cutoff to avoid leakage. Compare like-for-like runs; do
					not present an unevaluated forecast as validated. A plan restriction does not invalidate an
					otherwise successful forecast; state that backtesting was unavailable.
				</Span>
				<Title level={2}>Present the result</Title>
				<Span>
					Report the target, grain, cutoff, horizon, model, median, and interval, distinguishing predicted
					values from observed history. The interval is model uncertainty, not a guaranteed coverage rate. Use
					the returned summary and share link, or <Code>create_share_url</Code> to open the result in
					Retrocast. nao does not render the external MCP App viewer; use the text fallback. Long arrays may
					be abbreviated: never chart a truncated preview as a complete forecast. Only use nao&apos;s{' '}
					<Bold>display_chart</Bold> after complete output has been made available as a local query result;
					otherwise link to Retrocast.
				</Span>
			</Block>,
		),
};
