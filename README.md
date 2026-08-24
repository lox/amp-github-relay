# amp-subscribe

amp-subscribe connects external events to Amp threads.

An Amp thread can subscribe to something it cares about, go to sleep, and wake up when an event
arrives. The event becomes a user message in the same thread, so Amp can notify you, investigate
what changed, or prepare a fix with all of the thread's existing context.

GitHub pull requests and branches are supported today. The bridge is intended to support more
sources over time, such as Slack events and other notification systems; those integrations are not
implemented yet.

## Why this is useful

Without a subscription, you have to remember to return to a thread and ask Amp to check whether
anything changed. amp-subscribe lets the event bring Amp back instead.

For example:

- **Hand off a pull request and move on.** Ask Amp to watch a PR. When CI fails or a reviewer leaves
  feedback, the same thread wakes up with the relevant event and can investigate it.
- **Keep a human in control.** Use `notify` behavior when you only want a concise update, with no
  code or external changes.
- **Watch a release branch.** Subscribe to pushes and checks on `main` or a release branch so one
  thread can triage failures as they happen.
- **Preserve context.** The thread that created or reviewed a PR already knows the decisions behind
  it. Sending events there avoids starting over in a new conversation.

A typical conversation looks like this:

```text
You: Subscribe this thread to https://github.com/acme/widgets/pull/123.
     Investigate reviews and CI failures.

Amp: Subscribed this thread to acme/widgets#123.

...later, after the thread has gone idle...

GitHub: A check run failed on acme/widgets#123.
Amp: I inspected the failed run. The Linux test job is failing because...
```

## How it works

```text
GitHub App ──webhook──▶ amp-subscribe ──durable webhook──▶ Amp thread
                              ▲                                │
                              └──────── subscription ──────────┘
```

The Amp plugin creates a durable webhook for the current thread and registers a subscription with
the bridge. When GitHub sends a matching event, the bridge verifies it, finds the subscribed
threads, and forwards a small, validated event summary. Amp stores that event and wakes the thread
even if its orb was asleep.

The repository is currently organized as:

- `src/`: subscription API, SQLite storage, GitHub event adapter, and Amp webhook delivery.
- `plugin/github-relay.ts`: amp-subscribe's GitHub adapter plugin. Its compatibility filename keeps
  existing durable webhook URLs stable.
- `docs/github-app.md`: GitHub App permissions and webhook setup.

## Using the GitHub integration

Install `plugin/github-relay.ts` as `.amp/plugins/github-relay.ts` in a project or in your global Amp
plugin directory, then reload plugins. Keep this filename when upgrading an existing installation:
Amp scopes durable webhook identity to the plugin, so renaming the installed file would orphan
existing subscriptions. The plugin works in Amp-managed orbs, where durable webhooks can wake a
thread.

Ask Amp in natural language:

```text
Subscribe this thread to https://github.com/owner/repo/pull/123.
Only notify me about reviews and CI.
```

```text
Subscribe this thread to the main branch of owner/repo.
Investigate pushes and CI failures.
```

The plugin provides these tools:

- `github_pr_subscribe`: watch a pull request.
- `github_branch_subscribe`: watch pushes and checks on a branch.
- `github_pr_subscriptions`: list subscriptions owned by the current thread.
- `github_pr_unsubscribe`: remove a subscription.

A successful, direct `gh pr create` is subscribed automatically with `investigate` behavior when
the command output identifies exactly one PR. For asynchronous or compound commands, ask Amp to
subscribe after the PR is created.

### Behaviors

- `notify`: summarize the event without editing files or external state.
- `investigate` (default): inspect the current state needed to triage the event, without changing
  external state.
- `implement`: make and verify local changes, but do not push without explicit approval.

Pull request subscriptions can receive PR changes, commits, reviews, review comments, discussion
comments, checks, merges, and closures. Branch subscriptions support pushes and branch-associated
checks or workflow runs.

## Run it yourself

Install [mise](https://mise.jdx.dev/), then install the pinned Bun and Fly.io CLI versions:

```sh
mise install
cp .env.example .env
# Set GITHUB_WEBHOOK_SECRET and at least one AMP_ALLOWED_* allowlist.
# Set AMP_WEBHOOK_ALLOWED_HOSTS to the hostname or parent domain used by
# capability URLs returned by amp.createWebhook.
mise exec -- bun install
mise exec -- bun run start
```

`GET /healthz` is the health check. In production, keep `DATABASE_PATH` on persistent storage.

Configure the plugin with the bridge deployment it should use:

```text
AMP_SUBSCRIBE_URL=https://your-bridge.example
AMP_SUBSCRIBE_AUDIENCE=urn:your-org:amp-subscribe
```

`AMP_SUBSCRIBE_URL` is required; the reusable plugin does not assume a hosted deployment. Set the
service's `AMP_OIDC_AUDIENCE` to the same audience. The old
`AMP_GITHUB_RELAY_URL` and `AMP_GITHUB_RELAY_AUDIENCE` plugin variables remain accepted for
compatibility. `AMP_OIDC_AUDIENCE` accepts a comma-separated list during a migration; the checked-in
Fly configuration accepts both the new and legacy audiences so existing plugin installations keep
working. A self-hosted plugin configured with only `AMP_GITHUB_RELAY_URL` continues to use the
legacy audience by default.

### Fly.io

The checked-in `fly.toml` deploys `lox-amp-subscribe` with a persistent `relay.sqlite` volume. Before
the first deploy, set the GitHub webhook secret and at least one Amp identity allowlist:

```sh
mise exec -- flyctl secrets set GITHUB_WEBHOOK_SECRET=... AMP_ALLOWED_WORKSPACE_IDS=...
# For a personal Amp account without a workspace, use AMP_ALLOWED_USER_IDS instead.
mise run deploy
```

Create an app-scoped CI deploy token with:

```sh
mise exec -- flyctl tokens create deploy --app lox-amp-subscribe
```

Save the full token as the repository's `FLY_API_TOKEN` Actions secret. Configure the GitHub App
webhook as `https://lox-amp-subscribe.fly.dev/github/webhook` and install the app on every repository
whose events should reach Amp. See [GitHub App setup](docs/github-app.md) for the event and
permission list.

## Authentication, safety, and delivery

Subscription API requests use a short-lived Amp workload identity token rather than a shared API
key. The bridge verifies its signature, issuer, audience, expiry, and `token_use`, applies configured
workspace, project, or user allowlists, and derives ownership from the signed `thread_id`. A caller
cannot choose another thread in the request body.

GitHub requests are verified using `X-Hub-Signature-256` over the exact request bytes. Capability
webhook URLs are never returned by list or create responses, and delivery IDs are used for
deduplication. Delivery is limited to configured HTTPS host suffixes so the subscription API cannot
be used as an SSRF proxy. Dead Amp webhooks are removed when they return 404 or 410.

Repository-controlled prose is deliberately not forwarded. PR titles and bodies, comments, review
text, check output, commit messages, patches, and filenames remain untrusted data that Amp fetches
through its normal GitHub tools when needed. Only bounded event metadata—such as event type, state,
URL, actor, line number, and commit SHA—is included in the wake-up message.

Amp webhook delivery is at least once. The plugin suppresses duplicates while it is running; after
an executor crash, a duplicate visible event is possible and is preferable to losing the event.

## Development

```sh
mise run ci
```
