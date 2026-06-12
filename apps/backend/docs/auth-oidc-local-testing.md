# Local Testing: OIDC Authentication with Okta

This guide walks through manually testing the OIDC SSO feature end-to-end using Okta as the identity provider against a local development instance.

## Prerequisites

- A running local nao instance (`npm run dev`)
- An Okta developer account ([developer.okta.com](https://developer.okta.com))
- A valid Enterprise Edition license with the `sso` feature, or an equivalent dev-time bypass

## 1. Create an Okta Application

1. Sign in to the **Okta Admin Console**
2. Navigate to **Applications** → **Create App Integration**
3. Select **OIDC - OpenID Connect** and **Web Application**, then click **Next**
4. Configure the application:
    - **App integration name**: `nao-local` (or any name)
    - **Grant type**: Authorization Code
    - **Sign-in redirect URIs**: `http://localhost:3000/api/auth/oauth2/callback/okta`
    - **Sign-out redirect URIs**: `http://localhost:3000`
    - **Controlled access**: Allow everyone in your organization (or assign specific users/groups)
5. Click **Save**, then copy the **Client ID** and **Client Secret**

### Enable PKCE

In the application settings, under **General Settings** → **Client Credentials**, ensure that **Proof Key for Code Exchange (PKCE)** is enabled. This is the recommended configuration and matches `OIDC_PKCE=true` in the nao `.env`.

### Find the Discovery URL

1. Go to **Security** → **API** → **Authorization Servers**
2. Copy the **Issuer URI** for the `default` authorization server (e.g., `https://dev-xxxxx.okta.com/oauth2/default`)
3. Append `/.well-known/openid-configuration` to form the full discovery URL

### Configure the Authorization Server Access Policy

Okta has two separate policy layers — the **Authentication Policy** (controls login) and the **Authorization Server Access Policy** (controls token issuance). Both must allow access for the OAuth flow to complete.

1. Go to **Security** → **API** → **Authorization Servers** → select the `default` server
2. Open the **Access Policies** tab
3. If no policy exists, create one:
    - Click **Add Policy**, give it a name (e.g., `Default Policy`), and assign it to **All clients**
    - Click **Add Rule** inside the policy, name it (e.g., `Default Rule`), and keep the default settings (allow all grant types, all scopes)
4. Click **Save**

Without an access policy, Okta will authenticate the user but refuse to issue tokens, resulting in a "not allowed to access this app" error after login.

### Assign Users

Make sure the test users are assigned to the application:

1. Go to **Applications** → select your app → **Assignments** tab
2. Click **Assign** → **Assign to People** and add the users you want to test with

## 2. Configure nao Environment

Add the following to your `.env` file at the repository root:

```env
OIDC_PROVIDER_ID=okta
OIDC_PROVIDER_NAME=Okta
OIDC_DISCOVERY_URL=https://dev-xxxxx.okta.com/oauth2/default/.well-known/openid-configuration
OIDC_CLIENT_ID=<your-client-id>
OIDC_CLIENT_SECRET=<your-client-secret>
OIDC_SCOPES=openid,profile,email
OIDC_PKCE=true
```

Replace the placeholder values with the ones from your Okta application.

## 3. Run the Test

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000/login` in a browser
3. A **"Continue with Okta"** button should appear on the login page
4. Click it — you should be redirected to the Okta login page
5. Authenticate with your Okta credentials
6. After successful authentication, you should be redirected back to nao and logged in

## 4. Verify User Roles

nao assigns the **admin** role to the very first user created in the system. All subsequent users are created with the **user** role.

To verify this behavior:

1. **First user**: Log in via Okta with the first test account. Confirm the user is created with the `admin` role (visible in the settings/admin panel).
2. **Second user**: Log out, then log in via Okta with a different test account. Confirm this user is created with the `user` role.

This matches the standard nao behavior — the first-user-is-admin rule applies regardless of the authentication method.

## Troubleshooting

| Symptom                                          | Likely Cause                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| No "Continue with Okta" button                   | EE license/feature not active, or `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_DISCOVERY_URL` not set     |
| 404 on discovery URL                             | Missing `/.well-known/openid-configuration` suffix on the issuer URI                                         |
| `redirect_uri_mismatch`                          | Redirect URI in Okta doesn't match `http://localhost:3000/api/auth/oauth2/callback/okta` exactly             |
| "User is not assigned to the client application" | Test user not assigned to the Okta app (see **Assign Users** above)                                          |
| "You are not allowed to access this app"         | Missing Access Policy on the authorization server (see **Configure the Authorization Server Access Policy**) |
| TLS certificate errors in logs                   | Corporate proxy or self-signed certs — configure `NODE_EXTRA_CA_CERTS` or equivalent for your runtime        |
| Login succeeds but user can't see projects       | Expected — an admin must add the user to a project after first login                                         |
