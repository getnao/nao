# nao Cloud billing with Stripe

Status: implementation in progress for [issue #1459](https://github.com/getnao/nao/issues/1459).  
Scope: architecture, rollout guidance, and the current implementation state.

## Current implementation status

The branch now contains a cardless Stripe-hosted Checkout flow, organization Customer mapping, Customer Portal and paused-subscription recovery actions, a signed durable webhook inbox and worker, and a feature-gated Plan & Billing page. An organization admin can start one 14-day Stripe trial without entering payment details. Stripe pauses the subscription at trial end when no payment method exists, and signed webhooks update nao's local billing projection. Paid-access enforcement, reminders, and production rollout remain incomplete.

### Completed: Stripe SDK and client boundary

- The official `stripe` Node SDK is installed in the backend at version `22.6.2`.
- `apps/backend/src/services/stripe.service.ts` owns the server-side Stripe integration.
- The client is created lazily, so importing the service does not initialize Stripe or make a network request.
- The client is available only when both conditions are true:
    - `NAO_MODE=cloud`
    - `CLOUD_BILLING_ENABLED=true`
- The Stripe API version is pinned to `2026-08-26.dahlia`.
- Stripe requests use two automatic network retries.
- No Stripe package, secret, Price, or raw Stripe object is exposed to the frontend.

### Completed: billing configuration

The backend recognizes these server-only environment variables:

```env
NAO_MODE=cloud
CLOUD_BILLING_ENABLED=true
STRIPE_SECRET_KEY=
STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY=nao_cloud_monthly_v2
STRIPE_WEBHOOK_SECRET=
STRIPE_PORTAL_CONFIGURATION_ID=
```

Configuration behavior:

- Billing defaults to disabled.
- Billing remains inactive in self-hosted mode even if Stripe variables are present.
- When billing is enabled in cloud mode, startup requires:
    - `STRIPE_SECRET_KEY`
    - `STRIPE_WEBHOOK_SECRET`
    - `STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY`
- Empty values are normalized to missing values.
- `STRIPE_PORTAL_CONFIGURATION_ID` remains optional because the account's default portal configuration can be used.
- `NAO_DEFAULT_PROJECT_PATH` must remain unset in cloud mode under the existing environment rules.
- `.env.example` documents the variables without containing credentials.

The current validation checks that required configuration exists. It does not infer whether a secret belongs to live mode or a sandbox because nao's `MODE=prod` runtime setting is also used by non-production deployments. Live-versus-sandbox separation must therefore be controlled by deployment secrets and Stripe account setup.

The `/api/billing/stripe/webhook` route registers only when cloud billing is enabled. It requires `STRIPE_WEBHOOK_SECRET` and verifies every request against the exact raw body; there is no unsigned fallback.

### Completed: stable Price lookup and contract validation

The application does not persist or configure a sandbox-specific `price_...` identifier. It uses the stable lookup key:

```text
nao_cloud_monthly_v2
```

`getCloudMonthlyPrice()` asks Stripe for the active Price with that lookup key. The secret key determines whether the lookup runs against the sandbox or live Stripe environment.

Before returning the Price, the service verifies the complete v2 billing contract:

- the Price is active;
- the billing scheme is fixed/per-unit;
- the currency is EUR;
- `unit_amount` is `200000`, representing EUR 2,000.00;
- the Price is recurring;
- the interval is monthly;
- the interval count is `1`;
- the usage type is licensed rather than metered.

The service rejects a missing or mismatched Price with a clear server-side error. The resolved Price ID is intended for internal Checkout creation only and must never be accepted from the browser. It only finds and validates the price through Stripe but it does not mean at all that the user has a plan going.

### Completed: Stripe sandbox setup

The development sandbox currently has:

- a nao Cloud Product;
- an active EUR 2,000 monthly Price;
- the `nao_cloud_monthly_v2` lookup key;
- a sandbox secret key in the local environment;
- a Stripe CLI webhook signing secret in the local environment.

The configured Price has been queried through the real Stripe sandbox API and passed the application contract validation. No secret values or full Stripe responses were written to source files or logs during that verification.

For local webhook forwarding, Stripe CLI is authenticated to the sandbox and can run:

```bash
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,customer.subscription.trial_will_end,invoice.paid,invoice.payment_failed,invoice.payment_action_required,invoice.finalization_failed \
  --forward-to localhost:5005/api/billing/stripe/webhook
```

The listener must remain running while testing local webhook delivery. Its `whsec_...` signing secret must match `STRIPE_WEBHOOK_SECRET`.

### Completed: organization billing projection

The existing `organization` table now contains the nullable billing projection in both PostgreSQL and SQLite:

- `billingPlan`
- `billingStatus`
- `trialStartedAt`
- `trialEndsAt`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripePriceId`
- `currentPeriodEndsAt`
- `cancelAtPeriodEnd`
- `billingAccessEndsAt`
- `billingUpdatedAt`

All columns are nullable, so the migration does not classify or restrict existing organizations. Stripe Customer and Subscription IDs are unique when present. Billing statuses use one shared TypeScript definition covering `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `paused`, `incomplete`, and `incomplete_expired`.

Migration `0065_organization_billing` and its snapshots have been generated for both database dialects. PostgreSQL and SQLite migration parity checks pass. Because the webhook inbox belongs to the same logical billing migration, this migration must be amended rather than adding migration `0066` when the inbox is implemented on this branch.

This step adds storage only. It does not backfill existing organizations, initialize trials, write billing values, or change access.

Database representation details:

- PostgreSQL stores billing timestamps as `timestamp` columns and `cancelAtPeriodEnd` as a boolean.
- SQLite stores timestamps and the boolean using integer-backed Drizzle mappings.
- `stripeCustomerId` and `stripeSubscriptionId` each have a database-level unique constraint/index.
- `billingPlan`, `billingStatus`, and `stripePriceId` are text columns.
- Billing status validation currently exists at the TypeScript boundary. The migration does not add a database enum or check constraint.
- No card details, payment methods, invoice payloads, or full Stripe objects are stored.
- Existing organization, project, membership, and analytics rows are preserved.

#### Generated migration versus applied migration

Generating and committing a migration does not modify an already-created local, staging, or production database. Every database instance must apply migration `0065` before it runs application code that uses the updated `organization` schema.

From the repository root, apply pending migrations with:

```bash
npm run db:migrate -w @nao/backend
```

The backend should be stopped while applying the local SQLite migration and restarted afterward. A normal deployment must run the migration before, or atomically with, rollout of the code that selects the new organization columns.

The current migration only performs additive operations:

- adds eleven nullable columns to `organization`;
- adds a unique index/constraint for non-null Stripe Customer IDs;
- adds a unique index/constraint for non-null Stripe Subscription IDs;
- does not delete, rename, truncate, or rewrite existing customer data;
- does not assign a billing plan or status to existing organizations.

Do not generate another migration to fix a database that has merely not applied `0065`. Do not create `0066` for this purpose. Run the existing migration against the same `DB_URI` used by the backend.

#### Diagnosed local failure: `organization.billing_plan` is missing

The Plan & Billing page was observed showing:

```text
Unable to load billing details.
```

The corresponding backend error was:

```text
no such column: organization.billing_plan
```

This error means the running SQLite database predates migration `0065`. It is not evidence that the user lacks an organization. The Drizzle schema now selects `billing_plan` and the other billing columns whenever it materializes a complete organization row. Consequently, any route that selects the complete organization can fail against the stale database, including `organization.get` and `billing.getStatus`.

The correction is:

1. Stop the backend process.
2. Confirm the intended `DB_URI` is active.
3. Run `npm run db:migrate -w @nao/backend` from the repository root.
4. Restart the backend.
5. Refresh the frontend.

After migration, existing organizations will load successfully, but their new billing columns will remain null. That is expected until an explicit rollout policy or trial initializer writes them. The billing page will then show **No billing plan is assigned to this organization** and **Not configured**, rather than an error.

If the missing-column error remains after migration, the migration command and backend are almost certainly pointing at different database files or database servers. Compare the effective `DB_URI` and process working directory; do not regenerate the migration.

### Completed: cloud billing plan settings

The frontend now has a `/settings/organization/billing` route named **Plan & Billing**.

- The Organization settings navigation shows it only when cloud billing is enabled.
- Direct access redirects to Account settings when cloud billing is disabled.
- Settings search indexes the page only when cloud billing is enabled.
- The page loads the signed-in user's organization billing projection from the database through `billing.getStatus`.
- A plan summary is resolved only when the organization's persisted `billingPlan` matches `cloud_monthly_v2`.
- Backend plan policy supplies the stable plan key, display name, price, currency, interval, trial length, and user limit.
- The frontend formats those values without duplicating the billing contract.
- The page displays persisted status, trial end, paid-period end, and access end when those values exist.
- The page is visible to organization members; management actions are restricted to organization admins.
- Organization admins can start the cardless trial, open the Customer Portal, and recover a paused subscription.

The route verifies that billing is enabled and the caller belongs to an organization. It returns no Stripe Customer ID, Subscription ID, Price ID, or raw Stripe object. An organization whose billing columns are still null sees the available plan and trial action without the frontend inferring a subscription. The page never imports Stripe; it requests server-created hosted URLs.

#### Organization ownership, not project ownership

Billing is attached to an organization, not to a user and not to a project:

- one organization can own multiple projects;
- all organization members share the same subscription and entitlement;
- opening a working project does not prove that an organization billing row has been initialized;
- a project must not receive an independent trial or Stripe Customer;
- joining an existing organization must not create a second trial;
- switching projects inside one organization must not change the billing result.

The current endpoint resolves the authenticated user's membership with `getUserOrgMembership()`. It does not infer billing from the selected project header. The helper currently returns the first matching organization membership, which reflects the application's current single-organization user model. If multi-organization switching is introduced, billing must use an explicit selected organization context and revalidate membership server-side; it must not trust an arbitrary organization ID supplied by the browser.

A legacy project can continue to work while billing fails for one of two separate reasons:

1. the database has not applied the billing migration, in which case organization queries fail with a missing-column database error; or
2. the user/project truly has no organization membership, in which case `billing.getStatus` returns tRPC `NOT_FOUND` with `You are not a member of any organization`.

The diagnosed local failure was the first case: a stale schema, not a confirmed missing organization.

#### Where billing data comes from

`billing.getStatus` uses two local sources and makes no Stripe API request:

1. The database provides organization-specific state: the assigned `billingPlan`, billing status, trial dates, paid-period end, cancellation flag, and access end.
2. `apps/backend/src/types/billing.ts` provides the fixed v2 plan catalog metadata: **nao Cloud**, EUR 2,000 per month, a 14-day trial, and unlimited users.

The database does not currently store the EUR 2,000 display amount, and the status route does not fetch that amount from Stripe. The persisted `billingPlan` key merely selects the matching local plan definition. This keeps the billing page available when Stripe is slow or unavailable.

The separate `getCloudMonthlyPrice()` function does call Stripe and validates that the configured Stripe Price matches the local contract. Nothing currently calls that function during `billing.getStatus`; a future Checkout path will call it immediately before creating Checkout. A successful Price lookup proves only that the configured Stripe catalog is correct. It does not prove that the organization has a Customer, Subscription, or payment.

#### `billing.getStatus` request flow

The read path is intentionally narrow:

1. `protectedProcedure` requires an authenticated session.
2. `cloudBillingMemberProcedure` requires both `NAO_MODE=cloud` and `CLOUD_BILLING_ENABLED=true`.
3. The backend queries the database for the user's organization membership and the joined organization row.
4. A user without a membership receives `NOT_FOUND`.
5. The route reads the billing projection from that organization row.
6. If `billingPlan` is exactly `cloud_monthly_v2`, the backend returns the local plan policy.
7. The route returns a product-oriented response without exposing internal Stripe identifiers.

The conceptual response is:

```ts
{
  plan: {
    key: 'cloud_monthly_v2';
    name: 'nao Cloud';
    trialDays: 14;
    userLimit: null;
    amount: 200000;
    currency: 'eur';
    interval: 'month';
    intervalCount: 1;
  } | null;
  planKey: string | null;
  status: BillingStatus | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean | null;
  billingAccessEndsAt: Date | null;
  canManageBilling: boolean;
}
```

Field semantics:

- `plan` is display metadata for a recognized persisted plan. It is not proof of payment by itself.
- `planKey` is the raw stable nao plan key persisted on the organization.
- `status` is the persisted local projection of trial/subscription state.
- `trialStartedAt` and `trialEndsAt` describe the nao-owned pre-subscription trial.
- `currentPeriodEndsAt` is the projected Stripe subscription period boundary.
- `cancelAtPeriodEnd` indicates scheduled cancellation without implying immediate loss of access.
- `billingAccessEndsAt` is the application entitlement boundary used for local access decisions.
- `canManageBilling` is true only for an organization admin; it does not itself expose a mutation.

The route deliberately omits:

- `stripeCustomerId`;
- `stripeSubscriptionId`;
- `stripePriceId`;
- the Stripe secret key;
- the webhook secret;
- raw Stripe Customer, Subscription, Price, Invoice, or Event objects.

#### Plan metadata and Stripe availability

The organization database is authoritative for which plan and billing state the organization currently has. Display metadata is local so reading persisted billing status never depends on Stripe:

- when `billingPlan` is null, the route returns `plan: null` and makes no Stripe request;
- when `billingPlan` is `cloud_monthly_v2`, the route returns the fixed local plan contract;
- when `billingPlan` contains an unknown future key, the route preserves `planKey` but returns `plan: null`;
- a matching plan does not imply an active subscription; `status` and entitlement dates carry that meaning;
- `getCloudMonthlyPrice()` separately validates Stripe's configured Price before a future Checkout uses it.

#### Frontend state behavior

The page renders these states:

- while the query is pending: **Loading billing details…**;
- when the query fails: **Unable to load billing details.**;
- migrated organization with all billing fields null: available plan, trial action for admins, and status **Not configured**;
- recognized or available plan: plan name, formatted EUR price, monthly interval, unlimited users, and 14-day trial policy;
- persisted status: normalized status text;
- available dates: locale-formatted trial, current-period, and access boundaries;
- missing dates: an em dash;
- non-admin member: an explicit notice that only an organization admin can manage billing.

The current frontend intentionally uses one generic error string and does not expose raw backend or Stripe errors. Diagnose failures in backend logs. Expected backend failure categories are:

- `UNAUTHORIZED`: no valid user session;
- `NOT_FOUND`: billing is disabled or the user has no organization membership;
- database missing-column error: migration `0065` was not applied to the active database;

#### Files implementing the current read-only vertical slice

- `apps/backend/src/types/billing.ts`: shared status vocabulary and local plan policy.
- `apps/backend/src/db/pg-schema.ts`: PostgreSQL organization billing columns.
- `apps/backend/src/db/sqlite-schema.ts`: SQLite organization billing columns.
- `apps/backend/migrations-postgres/0065_organization_billing.sql`: PostgreSQL migration.
- `apps/backend/migrations-sqlite/0065_organization_billing.sql`: SQLite migration.
- `apps/backend/src/queries/organization.queries.ts`: membership plus organization lookup.
- `apps/backend/src/services/stripe.service.ts`: validated Stripe Price lookup for future Checkout use.
- `apps/backend/src/trpc/billing.routes.ts`: authenticated organization billing response.
- `apps/backend/src/trpc/router.ts`: billing router registration.
- `apps/frontend/src/routes/_sidebar-layout.settings.organization.billing.tsx`: query and page states.
- `apps/frontend/src/components/sidebar-settings-nav.tsx`: feature-gated navigation entry.
- `apps/frontend/src/components/settings-search-index.ts`: feature-gated settings search entry.
- `apps/backend/tests/billing.routes.test.ts`: database-projection route behavior.
- `apps/backend/tests/stripe.service.test.ts`: Stripe contract behavior.

### Completed: focused verification

Automated coverage currently includes:

- four environment tests for disabled defaults, required cloud configuration, self-hosted isolation, and valid sandbox configuration;
- one successful Price lookup test;
- one missing Price test;
- eight parameterized contract-rejection cases covering inactive, tiered, wrong-currency, wrong-amount, one-time, yearly, multi-month, and metered Prices;
- two billing route tests covering a persisted organization plan and an uninitialized organization.

The 10 Stripe service tests and two billing route tests pass. Backend TypeScript checking, targeted ESLint, targeted formatting, and the live sandbox Price lookup pass.

The repository-wide `npm run lint` command still fails on unrelated existing files, primarily browser-global `document` references in a generated project chart under `apps/backend/projects/`. The edited billing files pass their focused lint checks.

### Completed: cardless trial and webhook reconciliation

- `billing.createCheckoutSession` creates or reuses one organization Customer and starts hosted subscription Checkout.
- Checkout uses the validated server-side Price, quantity `1`, a 14-day trial, and `payment_method_collection=if_required`.
- No payment method is required to complete Checkout; Stripe pauses the subscription at trial end when none exists.
- `billing.createPortalSession` lets admins add payment details and manage the Stripe Customer.
- `billing.resumeSubscription` verifies a usable payment method before resuming a paused subscription.
- `/api/billing/stripe/webhook` verifies the raw signed body, deduplicates Event IDs, and durably enqueues processing.
- The retryable worker retrieves current Stripe state so delayed or out-of-order events converge on the latest subscription projection.
- The Plan & Billing page starts Checkout, confirms the webhook-backed trial, opens the Portal, and recovers paused subscriptions.

### Not implemented

The following work remains:

- hourly subscription reconciliation as a safety net for missed or previously mishandled webhooks;
- trial reminders and billing email coordination;
- paid-access resolution and enforcement at every cost-producing backend boundary;
- trial/payment banners and restricted-state frontend behavior;
- test-clock coverage for trial, renewal, failure, and cancellation;
- production Product, Price, secrets, portal configuration, and webhook destination.

### Next implementation milestone

The next milestone is hourly subscription reconciliation: find organizations with Stripe subscriptions, retrieve their current Stripe state, update the local billing projection, isolate per-organization failures, and log drift without customer PII. This is a safety net for missed webhooks, manual Stripe Dashboard changes, and projection bugs. After that, implement entitlement enforcement and customer communication.

## 1. Goal

nao Cloud needs self-serve, organization-level billing:

- Every cloud organization is eligible for one 14-day free trial started through Checkout.
- The initial paid plan costs EUR 2,000 per month.
- The plan includes unlimited users, so subscription quantity must always be `1`.
- Organization admins can add payment details, subscribe, view invoices, update payment methods, and cancel.
- Trial expiry and payment problems are communicated before access changes.
- Expired organizations lose paid capabilities gracefully without losing users, projects, conversations, stories, files, or configuration.
- The design must later support nao credit top-ups from [issue #1454](https://github.com/getnao/nao/issues/1454).

Billing is only active when `NAO_MODE=cloud`. The existing instance-wide enterprise license is not a cloud subscription and must not be reused as the billing source of truth.

## 2. Recommended product decisions

These decisions produce the smallest reliable v2:

1. Use Stripe-hosted Checkout to start a cardless trial subscription.
2. Use the Stripe Customer Portal for payment methods, invoices, and cancellation.
3. Keep one Stripe Customer and at most one current Stripe Subscription per nao organization.
4. Start the 14-day trial only after an organization admin completes Checkout. Do not require a card.
5. Once a Stripe subscription exists, treat Stripe as authoritative for payment and subscription state.
6. Keep only the Stripe identifiers and the access-relevant subscription projection in nao.
7. Process signed Stripe webhooks through a durable, idempotent inbox.
8. Keep expired organizations readable, but block operations that create cost or mutate deployed analytics state.
9. Configure cancellation for the end of the paid billing period, not immediate destructive shutdown.
10. Resolve one fixed server-side Price lookup key. Never accept a Price ID, amount, Customer ID, or organization ID from the browser as trusted billing input.

### Why the trial begins in Checkout

Organizations remain untrialed until an admin explicitly chooses **Start 14-day free trial**. Completing cardless Checkout creates the Stripe Subscription and starts the trial; abandoning Checkout consumes nothing. This keeps Stripe authoritative for the complete subscription lifecycle while avoiding payment details at signup. Persisted trial timestamps and existing Stripe subscriptions prevent a second trial after pause or cancellation.

## 3. Current nao integration points

The implementation should fit existing project boundaries rather than create a second billing architecture:

- Cloud signup creates a personal organization in `initializePersonalOrganization()` in `apps/backend/src/queries/organization.queries.ts`.
- The cloud authentication hook calls that function from `apps/backend/src/auth.ts`.
- Organization authorization already exists in `apps/backend/src/trpc/organization.routes.ts`.
- Project-aware authorization is centralized in `apps/backend/src/trpc/trpc.ts`.
- Raw Fastify routes are registered in `apps/backend/src/app.ts`.
- `fastify-raw-body` is already installed and used for signed Slack requests.
- Durable delayed work already uses `scheduled_job` and `apps/backend/src/services/scheduler.service.ts`.
- Organization settings already live under `/settings/organization`.
- Settings search must be updated in `apps/frontend/src/components/settings-search-index.ts`.
- PostgreSQL and SQLite schemas are maintained in parallel.

The payment feature should reuse those boundaries.

## 4. Stripe account and Dashboard setup

Perform all setup in a Stripe sandbox first. Test and live mode have separate Customers, Products, Prices, webhook endpoints, and secrets.

### 4.1 Account basics

Before implementation:

1. Complete the Stripe business profile.
2. Configure the public business name, support email, statement descriptor, logo, icon, and brand color.
3. Decide whether the EUR 2,000 price is tax-inclusive or tax-exclusive.
4. Confirm the legal entity that sends invoices and the required invoice fields.
5. Configure the customer email domain if Stripe emails should come from a branded domain.
6. Limit Dashboard access to the people who need it.

Do not enable Stripe Tax merely as a technical convenience. Tax collection depends on nao's registrations and commercial obligations. If Stripe Tax is enabled, Checkout must collect enough customer location information, and invoice finalization failures caused by missing location data must be handled.

### 4.2 Product and Price

Create one Product:

- Name: `nao Cloud`
- Description: organization subscription with unlimited users

Create one recurring Price:

- Currency: `EUR`
- Unit amount: `200000` cents
- Recurrence: monthly
- Usage type: licensed/fixed
- Quantity: always `1`
- Suggested lookup key: `nao_cloud_monthly_v2`

Stripe Prices are effectively immutable for amount and currency. A future pricing change should create a new Price rather than modifying the meaning of the existing Price ID. Existing subscriptions can remain on the old Price or be migrated deliberately.

Use the same lookup key in live mode and sandboxes, and resolve it to the environment-specific Price with the server's Stripe credentials. Validate its billing contract before use. The browser must never choose the amount.

### 4.3 Customer Portal

Activate and configure the [Stripe Customer Portal](https://docs.stripe.com/customer-management):

- Allow payment-method updates.
- Allow billing-address and tax-ID updates if required.
- Allow customers to view and download invoices.
- Allow cancellation at the end of the current billing period.
- Collect a cancellation reason if useful.
- Do not enable plan switching in v2 because only one plan exists.
- Set a return URL under the nao organization billing settings page.
- If a subscription is still trialing, configure `trial_update_behavior` to continue the trial instead of ending it when a customer edits the subscription.

Portal sessions are short-lived. nao should create a fresh session after every authenticated click and immediately redirect to its returned URL. The portal must not be embedded in an iframe.

### 4.4 Billing emails and revenue recovery

In Stripe Billing settings:

- Enable paid-invoice receipts.
- Enable failed-payment emails.
- Enable emails for payments that require customer action.
- Enable expiring-card notifications.
- Enable cancellation confirmations.
- Link billing emails to the Stripe-hosted Customer Portal.
- Configure [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries) for recoverable payment failures.

Stripe currently recommends eight attempts over two weeks as the default Smart Retries policy. The exact dunning period is a product decision because it determines how long `past_due` organizations retain full access.

nao should own product-specific trial reminders after the Stripe trial has been projected locally. Stripe should own receipts, invoice documents, payment-action messages, and payment-failure recovery emails.

### 4.5 Webhook destination

Create one snapshot-event webhook destination in Stripe Workbench:

```text
https://<cloud-domain>/api/billing/stripe/webhook
```

Subscribe only to events the application handles:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `customer.subscription.trial_will_end`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.finalization_failed`

`invoice.upcoming` is optional. Add it only if nao needs a custom renewal reminder or intends to modify upcoming invoices.

Pin the webhook destination to the same Stripe API version used by the server SDK. Stripe event payloads use the destination/account API version and old Event objects do not change when the account is upgraded.

## 5. Application configuration

Recommended server-only environment variables:

```env
CLOUD_BILLING_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY=nao_cloud_monthly_v2
# Required only when the webhook route is implemented:
STRIPE_WEBHOOK_SECRET=
STRIPE_PORTAL_CONFIGURATION_ID=
```

Rules:

- Billing remains inactive in self-hosted mode even if Stripe variables are present.
- `CLOUD_BILLING_ENABLED=false` allows local cloud development before Stripe is configured.
- When billing is enabled in cloud mode, startup should fail with a clear message if the secret key or monthly Price lookup key is absent.
- Until the webhook route exists, `STRIPE_WEBHOOK_SECRET` may be present but is unused and is not required for startup.
- Once implemented, the webhook route must require `STRIPE_WEBHOOK_SECRET`; missing configuration must disable route registration or fail startup, never permit unsigned requests.
- `STRIPE_PORTAL_CONFIGURATION_ID` can be optional when the account's default portal configuration is used.
- Hosted Checkout and the hosted Customer Portal do not require a publishable key in the frontend.
- Sandbox credentials must never be accepted in production, and live credentials must never be used in local development or CI.

Stripe secret keys belong in the deployment secret manager, not source control, `.env.example` values, logs, errors, client bundles, or database rows. Follow Stripe's [secret-key guidance](https://docs.stripe.com/keys-best-practices), including least privilege and key rotation.

## 6. Data model

### 6.1 Organization billing projection

Billing belongs to the organization. The current implementation extends the existing `organization` table instead of creating a separate one-to-one subscription table.

Implemented nullable columns:

- `billingPlan`: stable nao plan key such as `cloud_monthly_v2`
- `billingStatus`: normalized local status
- `trialStartedAt`
- `trialEndsAt`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripePriceId`
- `currentPeriodEndsAt`
- `cancelAtPeriodEnd`
- `billingAccessEndsAt`
- `billingUpdatedAt`

Implemented TypeScript status values:

- `trialing`
- `active`
- `past_due`
- `unpaid`
- `canceled`
- `paused`
- `incomplete`
- `incomplete_expired`

Important constraints:

- `stripeCustomerId` must be unique when non-null.
- `stripeSubscriptionId` must be unique when non-null.
- Trial timestamps are set from the first webhook-confirmed Stripe trial and are never reset.
- Joining an existing organization must not start another trial.
- Renaming an organization must not create a new Stripe Customer.
- A canceled organization keeps its Stripe identifiers for history and Customer Portal access.
- Do not store card numbers, payment-method payloads, invoice PDFs, or full Stripe Customer objects.

`billingAccessEndsAt` is an application entitlement boundary, not a second payment truth. It exists so access checks are local, fast, and resilient when Stripe is temporarily unavailable.

### 6.2 Webhook inbox

A new table is justified for webhook idempotency because Stripe retries and can deliver duplicates. Suggested fields:

- `id`: Stripe Event ID, primary key
- `type`
- `stripeObjectId`
- `livemode`
- `receivedAt`
- `processedAt`
- `lastError`

The raw event payload does not need to be retained. After signature verification, persist the Event ID and minimal routing metadata, then retrieve the current Stripe object during processing. This reduces stored payment data and prevents stale event snapshots from overwriting newer state.

Use the existing `scheduled_job` table to queue processing with a unique key such as `stripe-event:<event-id>`. The inbox is the durable receipt/deduplication record; the scheduler provides retries.

### 6.3 Migration rules

The billing schema change is one logical migration:

- Update PostgreSQL and SQLite schemas together.
- Generate synchronized migrations, snapshots, and journal entries.
- Do not create a second migration in the same pull request.
- Add nullable columns first so existing organizations continue to load.
- Do not silently classify existing cloud organizations as expired.

The organization projection is currently generated as migration `0065_organization_billing` for both PostgreSQL and SQLite. The webhook inbox must be added to this same migration before the branch is merged. A generated migration is not an applied migration: each runtime database must execute `npm run db:migrate -w @nao/backend` before application code selects the expanded organization schema.

Deployment order matters:

1. Back up the target database according to the environment's normal operational policy.
2. Confirm the migration command points to the intended `DB_URI`.
3. Apply the synchronized migration.
4. Verify migration completion.
5. Deploy or restart the backend code that reads the new columns.
6. Leave billing enforcement disabled until rollout policy and projection writers are ready.

Rolling out the code before the schema produces missing-column failures on organization reads. Applying the additive schema does not itself activate billing, assign plans, initialize trials, or restrict access.

Existing cloud organizations need an explicit rollout policy:

- grant a fresh 14-day trial at launch,
- grandfather them temporarily,
- or map manually managed customers to existing Stripe subscriptions.

That business decision must be made before migration backfill values are finalized.

## 7. Entitlement model

Payment state and product access are related but should not be identical.

### Full access

Grant full access when:

- billing is disabled,
- the deployment is self-hosted,
- the Stripe subscription is `trialing` or `active`,
- cancellation is scheduled but the paid period has not ended,
- or a `past_due` grace period is still active.

### Restricted access

Restrict cost-producing and state-changing operations when:

- the organization has no subscription after its trial,
- the Stripe subscription is `unpaid`, `paused`, or `incomplete_expired`,
- cancellation has completed,
- the subscription is absent after the applicable trial,
- or the configured `past_due` grace period has ended.

### What remains available

Graceful degradation should preserve:

- login and logout,
- account and organization administration,
- the billing status page,
- Checkout and Customer Portal redirects,
- reading existing projects, conversations, stories, and settings,
- invoice access through Stripe,
- and an export path for customer-owned data.

### What becomes unavailable

Block operations that generate cost or alter the deployed analytics environment:

- sending new agent messages,
- SQL execution and live story refresh,
- transcription and other model calls,
- scheduled or webhook-triggered automations,
- project deployment and repository import,
- new external integration execution,
- project creation if it allocates persistent resources,
- and background jobs that call models or databases.

Do not delete or archive customer data automatically. Do not disconnect repositories, delete files, remove members, or cancel jobs as a side effect of billing restriction. Jobs should remain configured and become no-ops until access returns.

### Central enforcement

Frontend banners are informative, not security controls. Enforcement must happen on the backend.

Use one billing access service that resolves the organization's effective entitlement. Call it from shared boundaries:

- a tRPC middleware used by cost-producing procedures,
- the raw `/api/agent` route,
- `/api/deploy`,
- automation webhook execution,
- scheduled automation/story refresh handlers,
- and any MCP or messaging-provider route that can trigger agent work.

Read-only procedures should continue to use their existing authorization without the paid-access middleware.

## 8. Core backend responsibilities

### 8.1 Stripe client

The implementation has one lazy server-side Stripe client:

- initialized only when cloud billing is enabled,
- configured with a pinned API version,
- isolated behind a small service boundary,
- never imported by frontend code,
- and easy to replace with a fake at the external boundary in tests.

Every mutating Stripe request uses an idempotency key. Stripe retains idempotency results for at least 24 hours, so keys identify a deliberate logical operation.

Useful key shapes:

- customer creation: organization ID plus a customer-creation version
- initial trial Checkout: organization ID plus a trial-Checkout version; reuse the Customer's matching open Session
- Portal session and subscription resume: organization/subscription ID plus a request UUID
- subscription mutation: subscription ID plus the intended transition and request UUID

Do not place email addresses or secrets in idempotency keys. See Stripe's [idempotent request documentation](https://docs.stripe.com/api/idempotent_requests).

### 8.2 Billing queries

Keep database access in focused billing/organization queries:

- initialize a trial atomically with organization creation,
- read billing state by organization,
- attach a Stripe Customer exactly once,
- update the subscription projection,
- insert a webhook event if it is new,
- mark an event processed or failed,
- and list organization admins for notifications.

Unique constraints plus transactions must make concurrent Checkout clicks safe.

The current read path reuses `getUserOrgMembership()`, which joins the user's membership to the organization row. Dedicated mutation queries do not exist yet. Checkout and webhook work must not write billing columns ad hoc from route handlers; use focused transactional query functions so uniqueness, ordering, and update invariants are enforced once.

### 8.3 tRPC billing routes

The `billing` router is registered and currently exposes:

- `getStatus`: read-only and available to every authenticated organization member when cloud billing is enabled.
- `createCheckoutSession`: organization admin only
- `createPortalSession`: organization admin only
- `resumeSubscription`: organization admin only

The current response includes persisted plan/status fields, trial and period dates, the access end, whether the caller is an organization admin, and product-oriented Checkout/Portal availability. It never returns Stripe identifiers.

The completed status API must eventually become a broader product-oriented view containing:

- effective access state,
- plan label,
- trial end,
- current paid period end,
- cancellation state,
- whether Checkout is available,
- whether the Customer Portal is available,
- and a user-facing action reason.

Do not return raw Stripe objects or secret configuration.

### 8.4 Stripe webhook route

Register a raw Fastify route outside tRPC:

```text
POST /api/billing/stripe/webhook
```

Requirements:

1. Enable `rawBody` for this route.
2. Read the `Stripe-Signature` header.
3. Verify the exact unmodified body with `STRIPE_WEBHOOK_SECRET`.
4. Reject invalid signatures with `400`.
5. Reject unexpected live-mode events in non-production environments.
6. Insert the Event ID into the webhook inbox.
7. Treat an existing Event ID as a successful duplicate and return `200`.
8. Enqueue durable processing.
9. Return `2xx` quickly without sending emails or making multiple Stripe calls inline.

Stripe requires the unmodified body for signature verification and recommends asynchronous handling. See [Receive Stripe events](https://docs.stripe.com/webhooks).

## 9. Lifecycle flows

### 9.1 New organization before trial

1. A new cloud user completes signup.
2. Existing domain/invitation logic first checks whether the user should join an organization.
3. Create the organization with nullable billing fields and add the user as organization admin.
4. Do not call Stripe from the authentication hook.
5. Show the available plan and cardless trial action on Plan & Billing.

Joining or creating an organization does not consume a trial. The Stripe-confirmed trial is projected only after Checkout completion.

### 9.2 Starting Checkout

When an organization admin chooses **Start 14-day free trial**:

1. Load the admin's organization from the authenticated session.
2. Reject Checkout if local history or Stripe already shows a subscription for the cloud plan.
3. Create or reuse one Stripe Customer.
4. Store `nao_org_id` in Stripe Customer metadata for operations and support.
5. Create a hosted Checkout Session with:
    - `mode=subscription`
    - the server-configured monthly Price
    - quantity `1`
    - the existing Stripe Customer
    - `payment_method_collection=if_required`
    - a 14-day subscription trial
    - pause-on-missing-payment-method end behavior
    - a success URL under nao
    - a cancel URL back to billing settings
    - the nao organization ID in metadata
6. Return only the Checkout URL to the browser.

The current Stripe Trial Offer API is a preview feature and is not supported by hosted Checkout. This v2 should therefore use Checkout's established subscription trial fields, not the preview Trial Offer API. Re-evaluate after that API becomes stable.

The Checkout success redirect is not proof of a trial. It displays a short “confirming trial” state and polls `getStatus`. Billing state changes only after the signed webhook has been reconciled.

### 9.3 Checkout completion

On `checkout.session.completed`:

1. Read the organization mapping from trusted server-created metadata.
2. Verify that the Session's Customer matches the stored Customer or atomically attach it.
3. Retrieve the current Subscription from Stripe.
4. Confirm that it uses the configured nao Product/Price.
5. Update the local projection.
6. Mark the event processed.

If delayed payment methods are enabled, also reconcile `checkout.session.async_payment_succeeded` and show a pending state until settlement. Do not enable payment methods whose settlement and recurring-payment behavior the product has not tested.

### 9.4 Subscription updates

For every subscription-created, updated, resumed, paused, or deleted event:

1. Resolve the organization by the unique Stripe Customer or Subscription ID.
2. Retrieve the latest Subscription from Stripe where possible.
3. Validate the expected Customer and Price.
4. Normalize the Stripe status into nao's billing projection.
5. Update period, trial, and cancellation timestamps.
6. Recompute `billingAccessEndsAt`.
7. Mark the event processed.

Stripe does not guarantee event order. Do not compare Event `created` timestamps to decide which event is newer. Retrieve current Stripe state so a delayed event cannot overwrite a newer subscription state.

### 9.5 Paid invoice

On `invoice.paid`:

- retrieve the related Subscription,
- update the organization to `active` when appropriate,
- advance the paid access boundary to the current paid period end,
- clear payment-failure presentation state,
- and retain cancellation-at-period-end if it is still configured.

Stripe notes that `active` alone does not prove every historical invoice is paid. Access should be based on the current subscription plus the current paid period, not the word `active` in isolation.

### 9.6 Failed or action-required payment

On `invoice.payment_failed`:

- set the local projection to `past_due` when Stripe reports that state,
- preserve access during the chosen dunning grace period,
- expose “Update payment method” to organization admins,
- and let Stripe Smart Retries handle collection.

On `invoice.payment_action_required`:

- surface an admin-only action banner,
- link to the hosted Stripe flow or Customer Portal,
- and do not mark the invoice paid until Stripe confirms it.

On `invoice.finalization_failed`:

- alert operations,
- inspect automatic-tax status if tax is enabled,
- tell admins when billing location is missing,
- and do not assume Stripe can collect payment.

### 9.7 Cancellation

The Customer Portal should schedule cancellation at period end:

- Set `cancelAtPeriodEnd=true` locally after webhook reconciliation.
- Continue full access through the paid period.
- Clearly show the last access date.
- Allow the admin to reverse cancellation through the portal while Stripe allows it.
- Restrict access only after Stripe reports cancellation and the paid entitlement has ended.

Cancellation never deletes nao data.

### 9.8 Trial expiry without a payment method

Stripe changes the subscription to `paused` when its trial ends without a payment method. The webhook worker projects that current state locally. The organization becomes restricted once access enforcement is enabled, while admins retain billing-page access to open the Portal, add payment details, and request an idempotent server-side resume.

## 10. Webhook reliability

Stripe retries live webhook delivery for up to three days with exponential backoff and can send the same event more than once. Delivery order is not guaranteed.

The processing contract must be:

1. Signature verification authenticates the request.
2. The Event ID primary key deduplicates delivery.
3. Durable enqueue happens before the HTTP `2xx`.
4. The worker retrieves current Stripe state.
5. Database updates are transactional.
6. Processing marks the inbox row complete.
7. Failures retain `lastError` and retry through the existing scheduler.
8. Replaying the same event produces the same final organization state.

For the rare case where Stripe emits two different Event IDs for the same object transition, reconciliation remains safe because processing fetches and projects the current Subscription rather than blindly applying a delta.

Add a periodic reconciliation job:

- find organizations with Stripe Customer or Subscription IDs,
- retrieve their current Stripe state,
- repair projection differences,
- log mismatches without customer PII,
- and alert when an identifier points to a missing or unexpected Stripe object.

This job is a safety net for missed webhooks, manual Dashboard edits, and deployments that were unavailable beyond Stripe's retry window.

## 11. Trial reminders and customer communication

Recommended nao-owned trial reminders:

- 7 days before expiry
- 3 days before expiry
- 1 day before expiry
- at expiry

Use one `scheduled_job` per organization/reminder offset with a deterministic unique key. Each handler must re-read billing state before sending:

- do nothing if the organization is paid,
- do nothing if the organization no longer exists,
- do nothing if the reminder was already superseded,
- send only to current organization admins,
- include the trial end timestamp in the recipient's timezone when available,
- link directly to organization billing settings.

The app should also display:

- a non-blocking trial countdown banner,
- a stronger warning during the final three days,
- a payment-failure banner for admins,
- a read-only notice after restriction,
- and a clear Subscribe or Manage billing action.

Avoid duplicate emails. nao owns product-specific trial reminders; Stripe owns invoice/payment communications configured in Billing settings. Stripe's available customer emails are documented under [Send customer emails](https://docs.stripe.com/invoicing/send-email).

## 12. Frontend experience

Add a cloud-only organization billing page, preferably:

```text
/settings/organization/billing
```

### Organization members

All members may see:

- current plan,
- trial or paid status,
- trial/period end date,
- cancellation state,
- and whether the organization is restricted.

### Organization admins

Admins additionally receive:

- Subscribe with Stripe
- Manage payment method
- View invoices
- Manage or cancel subscription

The management actions can all redirect to Stripe-hosted pages. Do not build custom card forms or invoice tables for v2.

### UX requirements

- Disable repeated Checkout clicks while a Session is being created.
- Treat browser return from Stripe as pending until the backend projection updates.
- Poll briefly, then offer a manual Refresh status action.
- Explain that cancellation takes effect at period end.
- Never display raw Stripe status identifiers without user-friendly copy.
- Keep the billing recovery route available in restricted mode.
- Ensure banners and buttons have accessible names and keyboard focus behavior.
- Add the billing page and actions to `settings-search-index.ts` with `cloudOnly` and `orgAdminOnly` where appropriate.

## 13. Future nao credit top-ups

Do not couple the subscription schema to user count or assume every Stripe payment is recurring.

Credit top-ups should later use:

- a separate one-time Stripe Checkout flow with `mode=payment`,
- server-selected top-up Price IDs,
- a dedicated credit ledger with immutable grant/spend entries,
- payment fulfillment from signed webhooks,
- and independent idempotency from subscription invoices.

The subscription implementation should leave room for:

- multiple stable nao plan keys,
- an Enterprise Cloud plan,
- one-time Purchase/PaymentIntent handling,
- and a credit balance service.

Do not add the credit ledger or Enterprise tier in issue #1459.

## 14. Testing strategy

### Unit tests

Test the access resolver at meaningful boundaries:

- first and last instant of the projected Stripe trial,
- active subscription,
- cancellation scheduled before period end,
- cancellation after period end,
- past-due within and outside grace,
- unpaid, paused, incomplete-expired, and canceled,
- self-hosted bypass,
- cloud billing feature disabled.

Test status normalization separately from route behavior.

### Backend integration tests

Use a fake only at the Stripe service boundary. Verify observable behavior:

- organization creation records exactly one 14-day trial,
- joining an existing organization does not create a trial,
- only organization admins create Checkout or Portal sessions,
- the server always uses the configured Price and quantity `1`,
- two concurrent Checkout requests do not create two Customers,
- invalid webhook signatures are rejected,
- duplicate Event IDs are acknowledged once,
- out-of-order events converge on current Stripe state,
- webhook processing updates the correct organization only,
- restricted organizations cannot send messages, deploy, or run automations,
- read-only access and billing recovery remain available.

### Stripe sandbox tests

Use the Stripe CLI for local webhook forwarding:

```bash
stripe listen --forward-to localhost:5005/api/billing/stripe/webhook
```

Copy the CLI-provided `whsec_...` value into the local webhook-secret environment variable. Do not use the Dashboard endpoint secret for CLI-forwarded events.

Use Stripe test cards when adding or replacing a payment method:

- `4242 4242 4242 4242` — successful payment;
- `4000 0000 0000 9995` — declined payment with insufficient funds;
- `4000 0025 0000 3155` — payment requiring 3D Secure authentication.

Use any future expiration date, any three-digit CVC, and test billing details. These numbers work only in Stripe test environments; never use real card data in the sandbox.

Exercise:

- successful cardless Checkout,
- abandoned Checkout without consuming a trial,
- adding a payment method before trial end,
- pausing at trial end without a payment method,
- adding a payment method and resuming,
- failed renewal,
- payment-method replacement,
- cancellation at period end,
- cancellation reversal,
- duplicate webhook resend,
- webhook delivery while the app is down,
- and manual Stripe Dashboard subscription edits.

Use [Stripe Billing simulations/test clocks](https://docs.stripe.com/billing/testing/test-clocks) to advance through trial end, invoice generation, retry periods, renewal, and cancellation. Keep Checkout end-to-end tests separate from API-created simulation fixtures where Stripe imposes test-clock limitations.

### Migration tests

Verify both database engines:

- a pre-billing organization remains readable after migration,
- untrialed organizations retain nullable trial timestamps,
- webhook-confirmed trials receive Stripe trial timestamps,
- self-hosted organizations do not accidentally receive cloud billing restrictions,
- unique Stripe identifiers reject cross-organization reuse,
- and schema snapshots/journals remain synchronized.

## 15. Security checklist

- Verify every webhook with the raw body and endpoint-specific signing secret.
- Use HTTPS for the production webhook.
- Subscribe only to required event types.
- Never trust redirect query parameters as payment proof.
- Never accept amount, Price ID, Customer ID, Subscription ID, or organization ID from the browser as authoritative.
- Resolve organization and role from the authenticated session.
- Require organization-admin role for Checkout and Customer Portal session creation.
- Keep Stripe keys server-side and in a secret manager.
- Use separate sandbox and live secrets.
- Pin and deliberately upgrade the Stripe API version.
- Use Stripe idempotency keys for mutating API calls.
- Do not log webhook bodies, card data, secrets, billing addresses, or tax IDs.
- Redact Stripe request errors before returning them to clients.
- Validate that webhook Customer, Subscription, Price, and `livemode` values match the expected deployment.
- Keep billing data out of analytics events unless fields are explicitly approved.
- Rotate a Stripe key immediately if it appears in source code, logs, chat, or a client bundle.

## 16. Observability and operations

Log structured identifiers:

- nao organization ID
- Stripe Event ID
- Stripe Customer ID
- Stripe Subscription ID
- event type
- processing result
- retry count

Do not log full Stripe objects or customer personal data.

Track metrics:

- Checkout Sessions created
- Checkout completion rate
- trial-to-paid conversion
- webhook signature failures
- webhook processing latency and failures
- inbox rows pending beyond an alert threshold
- reconciliation mismatches
- subscriptions by normalized status
- organizations restricted by reason
- payment recovery rate

Operational alerts should cover:

- repeated webhook failures,
- invoice finalization failures,
- live events arriving in a non-live environment,
- unknown Price IDs,
- a Customer or Subscription mapped to multiple organizations,
- Stripe API outage/error spikes,
- and reconciliation drift.

Create a short runbook for:

- resending an Event from Stripe Workbench,
- replaying an inbox event safely,
- rotating the secret key,
- rotating the webhook secret,
- correcting an organization mapping,
- granting a manual temporary extension,
- and disabling billing enforcement without deleting billing state.

## 17. Rollout plan

### Phase 1: sandbox foundation

- Completed: create the sandbox Product and validated Price with stable lookup key.
- Completed: configure a local Stripe CLI webhook signing secret and forwarding command.
- Completed: add configuration validation and the Stripe service boundary.
- Completed: add the organization billing projection to synchronized PostgreSQL and SQLite migration `0065`.
- Completed: add the read-only organization billing route and cloud-only Plan & Billing page.
- Completed: add the webhook inbox to migration `0065`.
- Completed: add cardless Checkout, Customer Portal, resume, signed webhook, worker, and live billing actions.
- Remaining: apply migration `0065` independently to every runtime database.
- Remaining: create and validate the Customer Portal configuration.
- Remaining: register deployed sandbox webhook destinations; Stripe CLI forwarding covers local development only.
- Keep `CLOUD_BILLING_ENABLED=false` by default.

### Phase 2: entitlement and communication

- Add trial/payment banners and reminders.
- Add access enforcement at all cost-producing backend boundaries.
- Complete automated and sandbox tests.

### Phase 3: internal rollout

- Enable billing in a non-production cloud environment.
- Run trial, renewal, failed-payment, cancellation, and replay simulations.
- Verify SMTP and Stripe email ownership.
- Review tax and invoice configuration.
- Confirm support and finance access to Stripe.

### Phase 4: production rollout

- Create live Product/Price and portal configuration.
- Install live secrets from the deployment secret manager.
- Register the live webhook destination.
- Decide and apply the existing-organization migration policy.
- Enable billing for internal organizations first.
- Monitor webhook and reconciliation health.
- Expand to all new organizations.

### Rollback

Rollback must disable enforcement, not erase state:

- set the feature flag off,
- preserve Stripe identifiers and webhook inbox rows,
- continue accepting and recording signed webhooks if possible,
- keep subscriptions unchanged in Stripe,
- and restore enforcement after the application issue is corrected.

## 18. Expected implementation map

The eventual implementation will likely touch:

- `apps/backend/package.json` for the official Stripe Node SDK
- `apps/backend/src/env.ts` for validated billing configuration
- PostgreSQL and SQLite schemas plus one synchronized migration
- a Stripe client/service and billing access service
- billing queries
- billing tRPC routes
- a raw Stripe webhook route
- webhook and reminder job handlers
- email components/builders for nao-owned trial notices
- backend access boundaries for agent, deploy, automation, and background work
- a cloud-only organization billing settings route
- global trial/payment banners
- `apps/frontend/src/components/settings-search-index.ts`
- focused backend/frontend tests

This list is a guide, not a requirement to create an abstraction or file when an existing module can own the behavior cleanly.

## 19. Acceptance checklist

- An eligible cloud organization can explicitly start exactly 14 days of access without a card.
- A user joining an existing organization does not create a second trial.
- The EUR 2,000 monthly price and quantity are chosen only by the backend.
- Only organization admins can start or manage billing.
- Checkout starts the trial without requiring payment details.
- A Checkout redirect alone never grants paid access.
- Signed webhooks are idempotent, asynchronous, and safe out of order.
- Paid invoices extend access.
- Failed payments enter a documented grace/recovery flow.
- Trial expiry and completed cancellation restrict cost-producing operations.
- Existing customer data remains readable and is never deleted due to billing state.
- Customer Portal provides payment-method, invoice, and cancellation management.
- Self-hosted behavior is unchanged.
- PostgreSQL and SQLite stay synchronized.
- Sandbox test clocks cover trial, renewal, failure, and cancellation.
- The schema can later support additional plan keys and one-time credit purchases.

## 20. Product decisions still required

Resolve these before implementation is considered complete:

1. Is EUR 2,000 tax-inclusive or tax-exclusive?
2. Will Stripe Tax be enabled at launch?
3. Which recurring payment methods are supported at launch?
4. How long is the `past_due` grace period?
5. After retries, should Stripe mark subscriptions `unpaid` or cancel them?
6. Which read-only/export actions remain available after restriction?
7. Which existing cloud organizations with external/manual billing history must be marked ineligible before rollout?
8. Can support grant a temporary extension, and how is that audited?
9. Should cancellation always occur at period end?
10. Which trial reminder schedule and wording should nao use?
11. What legal invoice fields, cancellation disclosures, and tax IDs are required?

## 21. Stripe references

- [SaaS subscriptions](https://docs.stripe.com/get-started/use-cases/saas-subscriptions)
- [Build subscriptions with Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Recurring payments](https://docs.stripe.com/recurring-payments)
- [Subscription trials](https://docs.stripe.com/billing/subscriptions/trials)
- [Subscription webhooks and statuses](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Webhook endpoint behavior and security](https://docs.stripe.com/webhooks)
- [Customer Portal](https://docs.stripe.com/customer-management)
- [Billing simulations and test clocks](https://docs.stripe.com/billing/testing/test-clocks)
- [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Customer billing emails](https://docs.stripe.com/invoicing/send-email)
- [Idempotent API requests](https://docs.stripe.com/api/idempotent_requests)
- [Secret-key best practices](https://docs.stripe.com/keys-best-practices)
