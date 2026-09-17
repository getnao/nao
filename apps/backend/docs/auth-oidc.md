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

| Variable                       | Required | Default                | Description                                                                                               |
| ------------------------------ | -------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `OIDC_PROVIDER_ID`             | No       | `oidc`                 | Unique identifier — used in callback URL and internally                                                   |
| `OIDC_PROVIDER_NAME`           | No       | `SSO`                  | Display name shown on the login button ("Continue with {name}")                                           |
| `OIDC_DISCOVERY_URL`           | **Yes**  | —                      | Provider's OIDC discovery endpoint                                                                        |
| `OIDC_CLIENT_ID`               | **Yes**  | —                      | OAuth client ID from your identity provider                                                               |
| `OIDC_CLIENT_SECRET`           | **Yes**  | —                      | OAuth client secret                                                                                       |
| `OIDC_SCOPES`                  | No       | `openid,profile,email` | Comma-separated list of OAuth scopes                                                                      |
| `OIDC_AUTH_DOMAINS`            | No       | —                      | Comma-separated email domain allowlist                                                                    |
| `OIDC_PKCE`                    | No       | `true`                 | Enable PKCE (Proof Key for Code Exchange)                                                                 |
| `OIDC_GROUPS_CLAIM`            | No       | `groups`               | Name of the ID token claim holding the user's groups                                                      |
| `OIDC_GROUP_NAO_ROLE_MAPPING`  | No       | —                      | Maps IdP groups to organization roles — see [Organization-role mapping](#organization-role-mapping)       |
| `OIDC_GROUP_NAO_GROUP_MAPPING` | No       | —                      | Maps OIDC groups to nao User Groups — see [SSO to nao User Group mapping](#sso-to-nao-user-group-mapping) |
| `SSO_SESSION_MAX_AGE`          | No       | —                      | Maximum OIDC session age in seconds, measured from when the session was created                           |

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

When a user clicks an app tile in their identity provider (Okta's **My Apps**, Auth0's dashboard, …), the provider redirects to nao and expects nao to start the authorization flow.

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

## Organization-role mapping

Organization-role mappings are configured with environment variables:

| Provider        | Canonical variable                | Entry format           | Deprecated alias              |
| --------------- | --------------------------------- | ---------------------- | ----------------------------- |
| Generic OIDC    | `OIDC_GROUP_NAO_ROLE_MAPPING`     | `idp-group:role`       | `OIDC_GROUP_ROLE_MAPPING`     |
| Microsoft Entra | `AZURE_AD_GROUP_NAO_ROLE_MAPPING` | `group-object-id:role` | `AZURE_AD_GROUP_ROLE_MAPPING` |

```env
OIDC_GROUP_NAO_ROLE_MAPPING=nao-admins:admin,nao-analysts:user,nao-viewers:viewer
AZURE_AD_GROUP_NAO_ROLE_MAPPING=a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin
```

Multiple mappings are comma-separated. Valid organization roles are `admin`, `user`, and `viewer`. `context_admin` is a project role and is invalid here. When several groups match, the strongest role wins: `admin` > `user` > `viewer`.

These mappings update only the organization role; they never create or change explicit project roles. Projects without an explicit membership continue to use normal organization access. Organization roles refresh on every SSO login, while project roles remain editable. A demotion is skipped if it would leave the organization without an admin.

The deprecated aliases remain temporarily supported and emit a startup warning. If both names are set, the canonical variable wins and the deprecated value is ignored.

For a normal groups claim, a user who belongs to no mapped organization-role group is denied sign-in. A missing or unreadable claim leaves existing access unchanged instead of risking a deployment-wide lockout.

### Emitting the OIDC groups claim

nao reads OIDC groups from the **ID token**, not from the userinfo endpoint. Configure your provider accordingly.

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

Keycloak needs a _Group Membership_ mapper with **Add to ID token** enabled. Auth0 needs an Action that adds a namespaced claim; point `OIDC_GROUPS_CLAIM` to that claim, for example `https://your-namespace/groups`.

To inspect the stored token, open **Settings** → **Organization Settings** and find **Single sign-on token**. It shows the groups nao received, matched mappings, resolved organization role, and raw claims. This card is available to self-hosted organization admins.

## SSO to nao User Group mapping

User Group mapping controls nao User Group membership separately from organization roles.

### Configure mappings in the UI

Open **Settings** → **User Groups**, select a User Group, and open its **SSO** tab. The tab appears only when the deployment has the `sso` entitlement and at least one SSO provider is configured.

- For generic OIDC, add group names from the configured groups claim.
- For Microsoft Entra, add group **Object IDs**, not display names.
- Multiple identifiers on one nao User Group use OR semantics.
- The default **All Users** group cannot be mapped.

Environment-controlled mappings appear read-only with a `.env` badge. If an environment mapping sends an identifier to a different nao User Group, the saved UI mapping is shown as overridden.

### Configure mappings in the environment

| Provider        | Variable                           | Entry format                                | Example                                  |
| --------------- | ---------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Generic OIDC    | `OIDC_GROUP_NAO_GROUP_MAPPING`     | `idp-group:project-id-or-*:nao-group`       | `finance-team:*:Analysts`                |
| Microsoft Entra | `AZURE_AD_GROUP_NAO_GROUP_MAPPING` | `group-object-id:project-id-or-*:nao-group` | `<object-id>:<project-id-or-*>:Analysts` |

Multiple mappings are comma-separated. The project scope is either the internal project ID or `*` for every project. An exact project mapping takes precedence over a wildcard mapping for the same identifier.

To copy the internal ID, open **Settings** → **Project Settings & Budget** and use the copy button beside **Project ID** in the **Information** card. Project names are not valid scopes.

OIDC identifiers and nao User Group names are matched case-insensitively. Entra identifiers must be valid group Object IDs. Values cannot contain commas or colons, and conflicting duplicate entries make the configuration invalid.

For the same identifier and project, an environment mapping overrides the UI mapping. This remains true when the environment target is missing, locked, or otherwise unavailable: nao does not fall back to the UI target. UI mappings for other identifiers continue to apply.

### Default project role

Each mapped nao User Group can define a **Default project role** for SSO provisioning. When a matching user has no explicit access to that project, nao creates project membership with that role. Existing explicit project roles are never changed or removed.

If several matched User Groups specify defaults, the strongest wins: `admin` > `context_admin` > `user` > `viewer`.

**Use organization role** stores no explicit project role. The user receives normal access inherited from their organization role. Organization-role mappings remain separate and cannot overwrite an explicit project role created by a User Group.

New OIDC and Entra users are added to the self-hosted default organization without pre-creating project membership, so a User Group's default project role can take effect on the first login.

### Login synchronization

On every OIDC or Entra login, nao reconciles UI and environment mappings against the latest identity-provider memberships:

- SSO-managed nao User Group memberships are added and removed automatically.
- Organization-role mappings are reapplied.
- Existing manually assigned project roles remain unchanged.
- In self-hosted deployments, an orphaned existing user is restored to the default organization before synchronization.

If claims, tokens, or Microsoft Graph membership checks are unavailable, nao preserves existing access rather than applying a partial result.

### Microsoft Entra group claims

Find a group's Object ID in the Microsoft Entra admin center:

1. Open **Identity** → **Groups** → **All groups**
2. Select the group
3. Copy **Object ID** from **Overview**

nao supports direct `groups` claims and Microsoft Graph overage claims (`_claim_names.groups` or `hasgroups`). For overage, nao checks only Object IDs referenced by UI mappings, User Group environment mappings, or organization-role environment mappings through Microsoft Graph's `/me/checkMemberObjects`.

### Licensing and free-tier limits

SSO mapping requires the `sso` entitlement. It does **not** require the unlimited User Groups entitlement.

The normal User Group limit still applies: the free tier supports three custom User Groups per project. Extra saved groups are locked and unavailable as mapping targets until the unlimited User Groups entitlement is active. An environment mapping to a locked group still overrides the same identifier's UI mapping, but grants no group membership.

Generic OIDC variables affect only generic OIDC logins, and `AZURE_AD_*` variables affect only Microsoft Entra logins.

## Session lifetime

Set `SSO_SESSION_MAX_AGE` to force OIDC users to authenticate with the identity provider again after a fixed number of seconds:

```env
SSO_SESSION_MAX_AGE=28800
```

The limit is measured from the session's creation time and is not extended by activity. When the limit is reached, nao revokes the session and the next session fetch returns the user to the login page. Email/password users are unaffected, preserving that login method as a break-glass path.

## Troubleshooting

| Symptom                                            | Likely cause                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SSO button not visible                             | Missing EE license with `sso` feature, or one or more of `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISCOVERY_URL` is not set     |
| 404 on discovery URL                               | Incorrect discovery URL — verify it returns JSON when opened in a browser                                                            |
| "redirect_uri_mismatch" error                      | The redirect URI registered in your IdP does not match `https://<host>/api/auth/oauth2/callback/{OIDC_PROVIDER_ID}` exactly          |
| "invalid_scope" error                              | Your provider doesn't support one of the requested scopes — check `OIDC_SCOPES`                                                      |
| "This email domain is not authorized"              | The user's email domain is not in `OIDC_AUTH_DOMAINS`                                                                                |
| "not assigned to any nao access group"             | The groups claim is present, but none of the user's groups appear in `OIDC_GROUP_NAO_ROLE_MAPPING`                                   |
| App tile lands on the login page                   | Initiate login URI is not set to `https://<host>/api/sso/start`                                                                      |
| Login succeeds but user can't see projects         | No mapped User Group created project access and the user has no other access — set a default project role or add the user manually   |
| Login succeeds but organization role never changes | The groups claim is missing from the ID token, or its name differs from `OIDC_GROUPS_CLAIM` — check Settings → Organization Settings |
| Organization role reverts after a user signs in    | Expected — `OIDC_GROUP_NAO_ROLE_MAPPING` makes the identity provider the source of truth for organization roles                      |
