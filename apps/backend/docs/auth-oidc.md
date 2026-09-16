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

| Variable                       | Required | Default                | Description                                                                           |
| ------------------------------ | -------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `OIDC_PROVIDER_ID`             | No       | `oidc`                 | Unique identifier — used in callback URL and internally                               |
| `OIDC_PROVIDER_NAME`           | No       | `SSO`                  | Display name shown on the login button ("Continue with {name}")                       |
| `OIDC_DISCOVERY_URL`           | **Yes**  | —                      | Provider's OIDC discovery endpoint                                                    |
| `OIDC_CLIENT_ID`               | **Yes**  | —                      | OAuth client ID from your identity provider                                           |
| `OIDC_CLIENT_SECRET`           | **Yes**  | —                      | OAuth client secret                                                                   |
| `OIDC_SCOPES`                  | No       | `openid,profile,email` | Comma-separated list of OAuth scopes                                                  |
| `OIDC_AUTH_DOMAINS`            | No       | —                      | Comma-separated email domain allowlist                                                |
| `OIDC_PKCE`                    | No       | `true`                 | Enable PKCE (Proof Key for Code Exchange)                                             |
| `OIDC_GROUPS_CLAIM`            | No       | `groups`               | Name of the ID token claim holding the user's groups                                  |
| `OIDC_GROUP_ROLE_MAPPING`      | No       | —                      | Maps IdP groups to organization roles — see [Group role mapping](#group-role-mapping) |
| `OIDC_GROUP_NAO_GROUP_MAPPING` | No       | —                      | Maps OIDC groups to nao User Groups by stable project ID                              |
| `SSO_SESSION_MAX_AGE`          | No       | —                      | Maximum OIDC session age in seconds, measured from when the session was created       |

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

## Identity-provider-initiated sign-in

OIDC only defines app-initiated flows: when a user clicks an app tile in their identity provider (Okta's **My Apps**, Auth0's dashboard, …), the provider does not send tokens. It just redirects to the app with an `iss` query param and expects the app to start the flow.

nao exposes `GET /api/sso/start` for this. It starts the authorization request server-side and redirects the browser to the provider, so the user never sees the nao login page. Register it as the provider's initiate-login URI:

```
https://<your-nao-host>/api/sso/start
```

In Okta this lives under **General Settings** → **Login**: set **Login initiated by** to `Either Okta or App`, enable **Display application icon to users**, and set **Initiate login URI** to the URL above.

When OIDC is not configured, or the flow cannot be started, the endpoint redirects to `/login`.

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

## Group role mapping

By default every user who signs in through OIDC gets `DEFAULT_USER_ROLE`, and an admin adjusts roles by hand in nao. Set `OIDC_GROUP_ROLE_MAPPING` to derive the organization role from the identity provider's groups instead:

```env
OIDC_GROUP_ROLE_MAPPING=nao-admins:admin,nao-analysts:user,nao-viewers:viewer
```

Each entry is `group:role`. Group names are matched case-insensitively. The valid organization roles are `admin`, `user` and `viewer`; entries naming anything else are ignored. `context_admin` is project-only, so it is not valid here. A configuration containing only invalid roles does not activate role mapping.

### Behaviour

- The organization role mapping is applied **on every sign-in**. Moving someone between groups in your identity provider takes effect the next time they log in — it does not revoke an already-active nao session.
- If a user belongs to several mapped groups, the **most privileged** organization role wins, in the order `admin` > `user` > `viewer`.
- If the groups claim is present but a user belongs to **no** valid mapped group, sign-in is denied and their existing roles stay untouched.
- If the groups claim is missing or cannot be decoded, sign-in is allowed so a claim configuration error cannot lock everyone out. New users receive `DEFAULT_USER_ROLE`; existing users keep their current roles.
- A demotion is skipped when it would leave an organization without any admin.
- The mapping never creates, updates, demotes or removes explicit project memberships. Existing project roles keep their current or manually assigned values.
- Projects without an explicit membership continue to inherit the mapped organization role.
- While the mapping is active, organization role editing is read-only because those roles refresh at the next sign-in. Project role editing remains available.

### Emitting the groups claim

nao reads groups from the **ID token**, not from the userinfo endpoint. Configure your provider accordingly.

**Okta, custom authorization server** (issuer ends in `/oauth2/default` or `/oauth2/<id>`):

1. Go to **Security** → **API** → **Authorization Servers** and pick your server
2. Open the **Claims** tab → **Add Claim**
3. Name it `groups`, include it in the **ID Token** with **Always**
4. Set **Value type** to **Groups** and add a filter, e.g. **Starts with** `nao-`

**Okta, org authorization server** (issuer is the bare Okta domain):

1. Go to **Applications** → your app → **Sign On** tab
2. Under **OpenID Connect ID Token**, set **Groups claim type** to **Filter**
3. Set the claim name to `groups` and add a filter, e.g. **Starts with** `nao-`

Prefer a prefix filter over `.*`. Okta truncates the groups claim once a user is in roughly 100 matching groups, and a `nao-` convention keeps the mapping readable.

### Checking what the provider actually sent

**Settings** → **Enterprise** → **Single sign-on token** decodes the ID token stored at a user's last sign-in. It shows the claim nao read, the groups it found, which of them matched your mapping, the organization role that resulted, and the full raw claims. Use it to discover the right claim name before writing `OIDC_GROUP_ROLE_MAPPING`, and to answer "why does this person have this organization role" afterwards. Admins can inspect any project member; the page is admin-only and hidden on cloud.

**Other generic OIDC providers:** Keycloak needs a _Group Membership_ mapper on the client with **Add to ID token** enabled. Auth0 needs an Action adding a namespaced claim, which you then point at with `OIDC_GROUPS_CLAIM=https://your-namespace/groups`.

## User Group mapping

Admins can map several OIDC groups to each nao User Group in its SSO settings. The identifiers use OR semantics. An optional **Default project role** can create an explicit project membership the first time SSO assigns someone to that User Group, but only when no explicit membership exists. It never changes an existing project role.

Deployments can keep generic OIDC mappings in the environment:

```env
OIDC_GROUP_NAO_GROUP_MAPPING=finance-team:*:Analysts,leaders:stable-project-id:Managers
```

Each entry is exactly `oidc-group:project-scope:nao-user-group`. The project scope is `*` or an exact stable project ID; editable project names are not supported. OIDC and nao group names are trimmed and matched case-insensitively, while project IDs are exact. Commas and colons cannot appear inside any value.

A project-specific entry wins over a wildcard entry. The environment entry also replaces any UI target for that same claimed OIDC group in that project; UI mappings for the user's other claimed groups still apply. Conflicting repeated entries make the environment configuration invalid so they cannot broaden access.

If several matched User Groups grant access to a new project, nao uses the strongest configured default role: `admin` > `context_admin` > `user` > `viewer`. `OIDC_GROUP_ROLE_MAPPING` then updates only the organization role, so the new explicit project role survives the same login and later logins.

## Microsoft Entra group mapping

Microsoft Entra uses group **Object IDs** for both environment mappings:

```env
AZURE_AD_GROUP_NAO_GROUP_MAPPING=a0b1c2d3-e4f5-6789-abcd-ef0123456789:*:Analysts
AZURE_AD_GROUP_ROLE_MAPPING=a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin
```

`AZURE_AD_GROUP_NAO_GROUP_MAPPING` has the same project scope, precedence, case-insensitive target-name matching, and conflict protection as `OIDC_GROUP_NAO_GROUP_MAPPING`. A User Group's default project role creates an explicit project membership only when one is missing; it never changes an existing project role.

`AZURE_AD_GROUP_ROLE_MAPPING` controls organization roles only. Valid roles are `admin`, `user`, and `viewer`; `context_admin` is not accepted. The strongest matched role wins, the last-organization-admin guard still applies, and explicit project roles remain editable.

Entra group overage is resolved with Microsoft Graph's `/me/checkMemberObjects` using saved UI mappings and both Entra environment mappings as candidates. Invalid tokens, missing or expired access tokens, and Graph failures leave User Group memberships and organization roles unchanged. A normal verified `groups` claim with no mapped organization-role group denies sign-in. Overage cannot be checked safely until Better Auth stores the access token, so authentication fails open and nao resolves the role immediately after login; if that resolution fails, existing access remains unchanged.

Generic OIDC variables affect only generic OIDC logins, and `AZURE_AD_*` mappings affect only Microsoft logins.

## Session lifetime

Set `SSO_SESSION_MAX_AGE` to force OIDC users to authenticate with the identity provider again after a fixed number of seconds:

```env
SSO_SESSION_MAX_AGE=28800
```

The limit is measured from the session's creation time and is not extended by activity. When the limit is reached, nao revokes the session and the next session fetch returns the user to the login page. Email/password users are unaffected, preserving that login method as a break-glass path.

## Troubleshooting

| Symptom                                            | Likely cause                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSO button not visible                             | Missing EE license with `sso` feature, or one or more of `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISCOVERY_URL` is not set                 |
| 404 on discovery URL                               | Incorrect discovery URL — verify it returns JSON when opened in a browser                                                                        |
| "redirect_uri_mismatch" error                      | The redirect URI registered in your IdP does not match `https://<host>/api/auth/oauth2/callback/{OIDC_PROVIDER_ID}` exactly                      |
| "invalid_scope" error                              | Your provider doesn't support one of the requested scopes — check `OIDC_SCOPES`                                                                  |
| "This email domain is not authorized"              | The user's email domain is not in `OIDC_AUTH_DOMAINS`                                                                                            |
| "not assigned to any nao access group"             | The groups claim is present, but none of the user's groups appear in `OIDC_GROUP_ROLE_MAPPING`                                                   |
| App tile lands on the login page                   | Initiate login URI is not set to `https://<host>/api/sso/start`                                                                                  |
| Login succeeds but user can't see projects         | Expected — an admin needs to add the user to a project after their first login                                                                   |
| Login succeeds but organization role never changes | The groups claim is missing from the ID token, or its name differs from `OIDC_GROUPS_CLAIM` — check Settings → Enterprise → Single sign-on token |
| Organization role reverts after a user signs in    | Expected — `OIDC_GROUP_ROLE_MAPPING` makes the identity provider the source of truth for organization roles                                      |
