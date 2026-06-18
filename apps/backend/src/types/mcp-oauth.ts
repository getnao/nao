/**
 * OAuth client credentials for a remote MCP server, obtained via dynamic client
 * registration (RFC 7591) or configured statically. Stored per user alongside tokens.
 */
export interface McpOAuthClientInfo {
	client_id: string;
	client_secret?: string;
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
}
