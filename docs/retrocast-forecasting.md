# Forecast with t0-beta through Retrocast MCP

Connect nao to [Retrocast MCP](https://docs.retrocast.com/mcp) to forecast data with
t0-beta. Inference runs in Retrocast; nao queries and prepares the data, calls the
MCP tools, and explains the result. No local model weights or inference API key
are needed. Uploading data copies it into the connected user's Retrocast workspace.

## Connect

1. Use a Retrocast account and deploy nao at a public HTTPS URL. Set
   `BETTER_AUTH_URL` to that URL and `MCP_CLIENT_METADATA_ENABLED=true`. Retrocast's authorization server must be able to
   fetch `https://<nao-host>/api/mcp-oauth/client-metadata.json` without logging in.
   Keep the OAuth callback at `/api/mcp-oauth/callback` reachable too. A localhost
   HTTP deployment cannot use this metadata-document flow; use a public HTTPS
   deployment or tunnel with the corresponding `BETTER_AUTH_URL`.
2. Merge the following entry into your project's `agent/mcps/mcp.json`, preserving
   other servers:

    ```json
    {
    	"mcpServers": {
    		"retrocast": {
    			"transport": "streamable-http",
    			"url": "https://retrocast-backend-prod.fly.dev/mcp"
    		}
    	}
    }
    ```

3. In nao's project MCP settings, connect `retrocast` and complete OAuth. Each user
   connects their own account; do not paste a shared bearer token into the project.
   The agent can also initiate the connection using `mcp_connect` and the Connect
   button. Enable the tools needed for your workflow.
4. Ask: **"Forecast the next 30 days of daily revenue with t0-beta, showing the
   median and an 80% prediction interval."** Specify an existing Retrocast dataset
   ID, a saved file, or the warehouse metric to use. The built-in `forecasting`
   skill guides the agent; it is loaded automatically when relevant.

This is the account-authenticated forecasting MCP endpoint. The separate
`https://api.retrocast.com/mcp/docs` endpoint only serves documentation.

## Get data into Retrocast

For an existing dataset, inspect its readiness and columns before forecasting.
For new warehouse data, enable nao's **Sandboxes** capability and use this flow:

1. Query the complete history with `execute_sql` or `execute_semantic_query`, at
   the intended forecast grain. Do not use a preview limit as the training history.
2. Mount that query result as CSV using `execute_sandboxed_code.data_files`.
   Saved CSV/Parquet files can instead be mounted with `storage_files`.
3. Read the discovered schema at `/agent/mcps/retrocast/upload_dataset.json`, then
   invoke it through `mcp_call`. The hosted MCP cannot read nao's filesystem;
   `upload_dataset` returns a dataset ID and a presigned upload target.
4. PUT the file bytes to the returned target from the sandbox, using its returned
   headers and checking the HTTP status. This byte transfer needs no Retrocast
   credential: the URL itself authorizes the upload. Do not print that URL.
5. Call `confirm_dataset_upload` only after the transfer succeeds, repeating any
   column-role overrides. Check readiness and the timestamp/target suggestions
   against the actual columns.

Without code execution, use an existing Retrocast dataset or
`create_dataset_from_link` with a reachable presigned Parquet URL. A nao `/home`
path cannot be used as a remote ingestion URL.

## Forecast and report

Discover the tool schemas before calling them; MCP arguments differ from the
inference REST API. Select `model: "t0-beta"` explicitly and request quantiles
`[0.1, 0.5, 0.9]`. Specify the verified target and datetime columns, frequency,
horizon, and dimension scope. Confirm that future covariates are known at the
cutoff and check notices about skipped covariates.

Backtests are available on paid Retrocast plans. Use historical cutoffs and the
same horizon and series scope when assessing accuracy. Report whether the forecast
was backtested; do not describe prediction intervals as guaranteed coverage.

nao currently consumes the MCP's text result rather than its interactive MCP App.
Use the returned summary and Retrocast share link. Long arrays may be abbreviated
in text: do not reconstruct or chart missing values. A nao-native chart requires
complete output imported into its local query-result workflow.

## Connection checks

- A first `AUTH_REQUIRED` result means the user must complete the Connect flow.
- A metadata-document connection requires public HTTPS; proxy the metadata route
  as well as the callback, and verify that its `client_id` exactly matches its URL.
- A `422` means the tool arguments need correction against the discovered schema.
- A `429` means a rate or account limit was reached. Report it instead of retrying
  indefinitely. Consult the [MCP documentation](https://docs.retrocast.com/mcp)
  for current plan limits and supported clients.

Metadata documents are opt-in so private HTTPS deployments keep their existing
OAuth registration behavior. nao's SDK still supports dynamic registration for other MCP servers, and existing
registered client IDs take precedence over the metadata-document flow.
