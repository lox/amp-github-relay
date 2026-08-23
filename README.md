# amp-github-relay

Routes pull request events from one GitHub App to subscribed Amp orb threads. A thread can sleep;
Amp's durable webhook stores the forwarded event, wakes its orb, and starts a thread turn.

## Components

- `src/`: GitHub webhook receiver, subscription API, SQLite storage, and Amp event delivery.
- `plugin/github-relay.ts`: Amp plugin providing subscribe, list, and unsubscribe tools plus the
  durable webhook handler.
- `docs/github-app.md`: GitHub App permissions and event configuration.

## Run the relay

```sh
cp .env.example .env
# Fill every secret and set AMP_WEBHOOK_ALLOWED_HOSTS to the hostname or parent domain
# used by the capability URL returned by amp.createWebhook.
bun install
bun run start
```

The SQLite database must live on persistent storage in production. `GET /healthz` is the health
check. The service deliberately permits delivery only to configured HTTPS host suffixes to avoid
turning the subscription API into an SSRF endpoint.

## Install the orb plugin

Copy `plugin/github-relay.ts` into `.amp/plugins/github-relay.ts` in a project, or into the user's
global Amp plugin directory. Configure these as orb secrets:

```text
AMP_GITHUB_RELAY_URL=https://<relay-host>
AMP_GITHUB_RELAY_TOKEN=<same value as RELAY_API_TOKEN>
AMP_GITHUB_RELAY_SIGNING_SECRET=<same value as RELAY_SIGNING_SECRET>
```

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
- Relay-to-orb requests are separately HMAC signed over exact request bytes.
- Capability webhook URLs are never returned by list or create API responses.
- GitHub delivery IDs become Amp idempotency keys and successful forwards are deduplicated.
- A 404 or 410 from an Amp webhook removes that dead subscription without blocking other threads.
- Amp webhook delivery is at least once. The plugin guards duplicates within a running plugin;
  after an executor crash, a duplicate visible event remains possible and is preferable to loss.
- PR content is untrusted data. The relay forwards routing metadata, not comment bodies or titles.

## Development

```sh
bun install
bun test
bun run typecheck
```
