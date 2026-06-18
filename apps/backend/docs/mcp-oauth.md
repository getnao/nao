# OAuth for remote MCP servers

nao can connect to OAuth-protected remote MCP servers (for example Mixpanel's hosted MCP at `https://mcp-eu.mixpanel.com/mcp`) on a **per-user** basis. Each user authorizes with their own credentials, so the remote server's existing permissions and roles apply to that user's tool calls.

This is distinct from the static `headers` / stdio `env` mechanism, which shares a single credential across everyone. It is also distinct from OIDC/SSO, which governs how users _log in to nao_ — this feature is an **outbound connector** (nao → an external tool's MCP) and ships in the open-source edition (no license required).

## How it works

A remote HTTP server opts into the per-user OAuth flow by adding an `oauth` block to its entry in `agent/mcps/mcp.json`. Servers without an `oauth` block are unchanged: stdio and static-header HTTP servers keep using the bundled mcporter runtime.

For an OAuth server, nao bypasses mcporter and drives the `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` directly with a nao-owned, database-backed `OAuthClientProvider`:

1. A user starts the flow from **Settings → MCP Servers** (the "Connect" button next to the server).
2. nao runs OAuth 2.1 discovery and, if the server supports it, **dynamic client registration** (RFC 7591). Otherwise it uses a pre-registered `clientId`.
3. The browser is redirected to the server's authorization page. The PKCE `code_verifier` and a CSRF `state` are persisted server-side for the duration of the flow.
4. The server redirects back to nao's callback, which exchanges the authorization code for tokens and stores them for that `(user, project, server)`.
5. The user's tools for that server now appear in chat and execute under their own token. The SDK refreshes the access token automatically using the stored refresh token.

Tokens are stored in the `mcp_oauth_token` table; the short-lived authorization handshake is stored in `mcp_oauth_flow`. Both are keyed per user and cascade-deleted with the user or project.

## Configuration

Add an `oauth` block to the server entry in `agent/mcps/mcp.json`:

```json
{
	"mcpServers": {
		"mixpanel": {
			"transport": "streamable-http",
			"url": "https://mcp-eu.mixpanel.com/mcp",
			"oauth": {
				"dynamicRegistration": true,
				"scopes": []
			}
		}
	}
}
```

### `oauth` fields

| Field                 | Required | Description                                                                                            |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `dynamicRegistration` | No       | When `true`, nao registers a client with the server automatically (RFC 7591). No `clientId` is needed. |
| `clientId`            | No       | Pre-registered OAuth client ID. Required when the server does not support dynamic client registration. |
| `clientSecretEnv`     | No       | Name of the environment variable holding the client secret (for confidential clients). Not the secret. |
| `scopes`              | No       | OAuth scopes to request. Omit or leave empty to use the server's defaults.                             |

The callback nao registers with the authorization server is `https://<your-nao-host>/api/mcp-oauth/callback`, derived from `BETTER_AUTH_URL`. If the server requires the redirect URI to be pre-registered (no dynamic registration), register that exact URL.

## Connecting and disconnecting

- **Connect** — Settings → MCP Servers → "Connect" next to the server. Any project member can connect their own account.
- **Disconnect** — the same row shows "Disconnect" once connected; it deletes the user's stored tokens and tears down their connection.

A server with an `oauth` block lists no tools until the user has connected. Enabling/disabling individual tools (admin-only) applies to everyone, the same as for other MCP servers.

## Notes and limitations

- Per-user OAuth tools are wired into the interactive chat. Other run types (e.g. automations) use their own tool resolver and do not yet include OAuth MCP tools.
- Tool schemas are discovered per user when they connect, rather than from a shared service token. A server's tools therefore appear only after that user has connected.
- Local `nao chat` on a laptop can still use mcporter's built-in browser OAuth flow for quick testing; the per-user flow described here is for deployed, multi-user installs.
