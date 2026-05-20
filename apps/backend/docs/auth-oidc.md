# OIDC / SSO Authentication

nao supports single sign-on (SSO) via any OIDC-compliant identity provider using the standard OpenID Connect Discovery protocol. This includes — but is not limited to — Okta, Auth0, Keycloak, and OneLogin.

## Prerequisites

OIDC authentication requires an **Enterprise Edition license** with the `sso` feature enabled. Without a valid license, the OIDC login button will not appear even if the environment variables are configured.

## How It Works

nao uses better-auth's `genericOAuth` plugin with OIDC Discovery. You provide a discovery URL (the provider's `/.well-known/openid-configuration` endpoint), and the plugin auto-configures:

- Authorization endpoint
- Token endpoint
- Userinfo endpoint
- JWKS URI for token validation

No individual endpoint configuration is needed.

## Generic Setup Steps

1. **Register an OAuth / OIDC application** in your identity provider's admin console
2. **Set the redirect URI** to: `https://<your-nao-host>/api/auth/oauth2/callback/{OIDC_PROVIDER_ID}`
3. **Copy** the client ID and client secret
4. **Find the discovery URL** (see provider-specific instructions below)
5. **Set the environment variables** in your `.env` file

## Environment Variables

| Variable             | Required | Default                | Description                                                     |
| -------------------- | -------- | ---------------------- | --------------------------------------------------------------- |
| `OIDC_PROVIDER_ID`   | No       | `oidc`                 | Unique identifier — used in callback URL and internally         |
| `OIDC_PROVIDER_NAME` | No       | `SSO`                  | Display name shown on the login button ("Continue with {name}") |
| `OIDC_DISCOVERY_URL` | **Yes**  | —                      | Provider's OIDC discovery endpoint                              |
| `OIDC_CLIENT_ID`     | **Yes**  | —                      | OAuth client ID from your identity provider                     |
| `OIDC_CLIENT_SECRET` | **Yes**  | —                      | OAuth client secret                                             |
| `OIDC_SCOPES`        | No       | `openid,profile,email` | Comma-separated list of OAuth scopes                            |
| `OIDC_AUTH_DOMAINS`  | No       | —                      | Comma-separated email domain allowlist                          |
| `OIDC_PKCE`          | No       | `true`                 | Enable PKCE (Proof Key for Code Exchange)                       |

When the three required variables are not set, the SSO button is hidden from the login form.

## Provider-Specific Setup

### Okta

1. Go to **Okta Admin Console** → **Applications** → **Create App Integration**
2. Select **OIDC - OpenID Connect** and **Web Application**
3. Set the redirect URI to: `https://<your-nao-host>/api/auth/oauth2/callback/okta`
4. Under **Assignments**, assign the app to the users/groups who should have access
5. Copy the Client ID and Client Secret

```env
OIDC_PROVIDER_ID=okta
OIDC_PROVIDER_NAME=Okta
OIDC_DISCOVERY_URL=https://dev-xxxxx.okta.com/oauth2/default/.well-known/openid-configuration
OIDC_CLIENT_ID=0oaxxxxxxxxxxxxxxxx
OIDC_CLIENT_SECRET=your-client-secret
OIDC_AUTH_DOMAINS=yourcompany.com
```

> **Finding your discovery URL:** In Okta, go to **Security** → **API** → **Authorization Servers**. The issuer URI is shown for each server. Append `/.well-known/openid-configuration` to it.

### Auth0

1. Go to **Auth0 Dashboard** → **Applications** → **Create Application**
2. Select **Regular Web Application**
3. In **Settings**, set the **Allowed Callback URL** to: `https://<your-nao-host>/api/auth/oauth2/callback/auth0`
4. Copy the Client ID and Client Secret from the Settings tab

```env
OIDC_PROVIDER_ID=auth0
OIDC_PROVIDER_NAME=Auth0
OIDC_DISCOVERY_URL=https://your-tenant.us.auth0.com/.well-known/openid-configuration
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

> **Finding your discovery URL:** Your Auth0 domain is shown at the top of any application's Settings page. The discovery URL is `https://{domain}/.well-known/openid-configuration`.

### Keycloak

1. Go to **Keycloak Admin Console** → **Clients** → **Create client**
2. Set **Client type** to **OpenID Connect**
3. Set the **Valid redirect URI** to: `https://<your-nao-host>/api/auth/oauth2/callback/keycloak`
4. Under **Credentials**, copy the Client Secret

```env
OIDC_PROVIDER_ID=keycloak
OIDC_PROVIDER_NAME=Keycloak
OIDC_DISCOVERY_URL=https://keycloak.example.com/realms/your-realm/.well-known/openid-configuration
OIDC_CLIENT_ID=nao
OIDC_CLIENT_SECRET=your-client-secret
```

> **Finding your discovery URL:** The format is `https://{keycloak-host}/realms/{realm-name}/.well-known/openid-configuration`.

### OneLogin

1. Go to **OneLogin Admin** → **Applications** → **Add App**
2. Search for **OpenID Connect (OIDC)**
3. In **Configuration**, set the **Redirect URI** to: `https://<your-nao-host>/api/auth/oauth2/callback/onelogin`
4. Under **SSO**, copy the Client ID and Client Secret

```env
OIDC_PROVIDER_ID=onelogin
OIDC_PROVIDER_NAME=OneLogin
OIDC_DISCOVERY_URL=https://your-domain.onelogin.com/oidc/2/.well-known/openid-configuration
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

## Domain Allowlist

Use `OIDC_AUTH_DOMAINS` to restrict which email domains can sign in. Comma-separated, case-insensitive:

```env
OIDC_AUTH_DOMAINS=yourcompany.com,subsidiary.com
```

When set, only users with email addresses matching one of the listed domains will be allowed to sign in. When unset, any email from the identity provider is accepted.

## PKCE

PKCE (Proof Key for Code Exchange) is enabled by default and recommended for all providers. Only disable it if your provider explicitly does not support it:

```env
OIDC_PKCE=false
```

## Scopes

Most providers work with the default scopes (`openid`, `profile`, `email`). If your provider requires additional scopes, set them as a comma-separated list:

```env
OIDC_SCOPES=openid,profile,email,groups
```

## Troubleshooting

| Symptom                                    | Likely cause                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| SSO button not visible                     | Missing EE license with `sso` feature, or one or more of `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISCOVERY_URL` is not set |
| 404 on discovery URL                       | Incorrect discovery URL — verify it returns JSON when opened in a browser                                                        |
| "redirect_uri_mismatch" error              | The redirect URI registered in your IdP does not match `https://<host>/api/auth/oauth2/callback/{OIDC_PROVIDER_ID}` exactly      |
| "invalid_scope" error                      | Your provider doesn't support one of the requested scopes — check `OIDC_SCOPES`                                                  |
| "This email domain is not authorized"      | The user's email domain is not in `OIDC_AUTH_DOMAINS`                                                                            |
| Login succeeds but user can't see projects | Expected — an admin needs to add the user to a project after their first login                                                   |
