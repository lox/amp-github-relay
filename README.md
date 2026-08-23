# amp-github-relay

Routes pull request events from one GitHub App to subscribed Amp orb threads. A thread can sleep;
Amp's durable webhook stores the forwarded event, wakes its orb, and starts a thread turn.

## Components

- `src/`: GitHub webhook receiver, subscription API, SQLite storage, and Amp event delivery.
- `plugin/github-relay.ts`: Amp plugin providing subscribe, list, and unsubscribe tools plus the
  durable webhook handler.
- `docs/github-app.md`: GitHub App permissions and event configuration.

## Authentication

Orb subscription requests do not use a shared API token. For every request, the plugin runs:

```sh
amp orb id-token --audience urn:lox:amp-github-relay --ttl-seconds 600
```

The relay verifies Amp's signature, issuer, audience, expiry, and `token_use` claim. It authorizes
the configured Amp workspace, project, or user IDs and derives subscription ownership from the
signed `thread_id` claim. A caller cannot select another thread through the request body.

`AMP_GITHUB_RELAY_TOKEN` and `RELAY_API_TOKEN` are not used or supported.

## Run the relay locally

Install [mise](https://mise.jdx.dev/) and let it install the pinned Bun and Fly.io CLI versions:

```sh
mise install
```

```sh
cp .env.example .env
# Set GITHUB_WEBHOOK_SECRET and at least one AMP_ALLOWED_* allowlist.
# Set AMP_WEBHOOK_ALLOWED_HOSTS to the hostname or parent domain used by
# capability URLs returned by amp.createWebhook.
mise exec -- bun install
mise exec -- bun run start
```

The SQLite database must live on persistent storage in production. `GET /healthz` is the health
check. The service deliberately permits delivery only to configured HTTPS host suffixes to avoid
turning the subscription API into an SSRF endpoint.

## Deploy to Fly.io

`fly.toml` runs one always-on shared-CPU machine in Sydney with a persistent 1 GB volume. Before
the first deploy, set the GitHub webhook secret and at least one Amp identity allowlist:

```sh
mise exec -- flyctl secrets set GITHUB_WEBHOOK_SECRET=... AMP_ALLOWED_WORKSPACE_IDS=...
# For a personal Amp account without a workspace, use AMP_ALLOWED_USER_IDS instead.
mise run deploy
```

Every pull request and push to `main` runs `mise run ci` in GitHub Actions. After CI succeeds for
a `main` push, a separate Deploy workflow deploys that exact commit to Fly.io. Create an app-scoped deploy token with
`mise exec -- flyctl tokens create deploy --app amp-pr-relay`, then save the full token as the
`FLY_API_TOKEN` repository Actions secret. The app, volume, and application secrets must exist
before the first automated deployment.

The GitHub App webhook URL is `https://amp-pr-relay.fly.dev/github/webhook`. Install the app on
every repository whose pull request events should reach subscribed orb threads; creating the app
alone does not install it.

## Install the orb plugin

Copy `plugin/github-relay.ts` into `.amp/plugins/github-relay.ts` in a project, or into the user's
global Amp plugin directory. The plugin needs no secret configuration. The published relay URL and
OIDC audience are built-in defaults; these optional overrides are only needed for another deployment:

```text
AMP_GITHUB_RELAY_URL=https://<relay-host>
AMP_GITHUB_RELAY_AUDIENCE=urn:lox:amp-github-relay
```

The plugin mints a ten-minute Amp workload identity token for each subscription API request. No
long-lived relay credential is stored in the orb. A successful direct `gh pr create` performed by
a synchronous shell tool is automatically subscribed with `investigate` behavior when its result
contains one pull request URL. After asynchronous or compound shell commands, the agent uses the
subscription tool with the created PR URL instead of guessing from mutable checkout state. The
plugin disables itself outside an Amp-managed orb because durable webhooks belong to orb threads.

Reload the plugin. A user can then say:

```text
Subscribe this thread to https://github.com/owner/repo/pull/123.
Only notify me about reviews and CI.
```

The agent calls `github_pr_subscribe`. Events are added as visible user messages with fixed
instructions based on the subscription behavior. PR-controlled text is not forwarded in the
trigger message; the awakened agent fetches current PR state using its normal GitHub tools.

## Subscription behavior

- `notify`: summarize only; do not edit files or external state.
- `investigate` (default): inspect and prepare a response without changing external state.
- `implement`: make and verify local changes, but do not push without prior explicit approval.

## Security and delivery

- GitHub requests are verified using `X-Hub-Signature-256` over exact request bytes.
- Subscription requests use Amp's RS256-signed OIDC workload identity. The relay derives the
  owning thread from the verified `thread_id` claim and enforces configured workspace, project,
  or user allowlists.
- Capability webhook URLs are never returned by list or create API responses.
- GitHub delivery IDs become Amp idempotency keys and successful forwards are deduplicated.
- A 404 or 410 from an Amp webhook removes that dead subscription without blocking other threads.
- Amp webhook delivery is at least once. The plugin guards duplicates within a running plugin;
  after an executor crash, a duplicate visible event remains possible and is preferable to loss.
- PR content is untrusted data. The relay forwards routing metadata, not comment bodies or titles.

## Development

```sh
mise run ci
```
