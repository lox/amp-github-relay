# amp-subscribe

amp-subscribe wakes up an Amp thread when something it cares about happens.

Tell Amp to watch a pull request, then move on. If CI fails, a reviewer comments, or the PR is
merged, the event returns to the same thread. Amp still has the context behind the work, so it can
notify you, investigate the change, or prepare a fix.

```text
You: Watch https://github.com/acme/widgets/pull/123 and investigate CI failures.
Amp: Subscribed this thread to acme/widgets#123.

...later, while the thread is idle...

GitHub: A check failed on acme/widgets#123.
Amp: The Linux test job failed because...
```

GitHub pull requests and branches are supported today. The bridge is designed to support other
event sources, such as Slack, in the future.

## Why use it?

- **Hand work off and move on.** You do not need to keep checking a PR or wake the thread manually.
- **Keep the useful context.** Reviews and failures return to the thread that understands the work.
- **Choose how Amp responds.** It can only notify you, investigate the event, or make a local fix.
- **Watch long-running work.** A thread can follow a PR, `main`, or a release branch while idle.

## Quick start

You need a running amp-subscribe bridge and its GitHub App installed on the repositories you want to
watch. To run your own bridge, see [Self-hosting](#self-hosting).

1. Install [`plugin/github-relay.ts`](plugin/github-relay.ts) as
   `.amp/plugins/github-relay.ts` for one project or
   `~/.config/amp/plugins/github-relay.ts` for every project.
2. Configure the plugin with your bridge URL and OIDC audience. These commands make the settings
   available to plugins installed in either location:

   ```sh
   printf %s https://your-bridge.example | \
     amp secrets set AMP_SUBSCRIBE_URL --user --env --data-file -
   printf %s urn:your-org:amp-subscribe | \
     amp secrets set AMP_SUBSCRIBE_AUDIENCE --user --env --data-file -
   ```

3. Run `amp orb restart-processes` to load the new environment, then run `plugins: reload` from
   Amp's command palette. You can now ask Amp:

   ```text
   Subscribe this thread to https://github.com/owner/repo/pull/123.
   Investigate reviews and CI failures.
   ```

   Or watch a branch:

   ```text
   Subscribe this thread to the main branch of owner/repo.
   Notify me about pushes and CI failures.
   ```

Keep the plugin filename `github-relay.ts` when upgrading. Amp includes the plugin identity in its
durable webhook URLs, so renaming it would disconnect existing subscriptions.

### Response modes

- `notify`: report what happened without changing anything.
- `investigate` (default): inspect and explain the event without changing external state.
- `implement`: make and verify local changes, but do not push without permission.

When Amp creates a PR directly with `gh pr create`, the plugin automatically watches it in
`investigate` mode. You can also ask Amp to list or remove this thread's subscriptions.

## How it works

```text
GitHub App ──webhook──▶ amp-subscribe ──durable webhook──▶ Amp thread
                              ▲                                │
                              └──────── subscription ──────────┘
```

The plugin creates a durable webhook for the current Amp thread and registers what it wants to
watch. amp-subscribe verifies matching GitHub events and forwards a small event summary to that
webhook. Amp stores the event and wakes the thread even when its orb is asleep.

## Self-hosting

Install [mise](https://mise.jdx.dev/), then:

```sh
mise install
mise exec -- bun install
cp .env.example .env
```

Edit `.env` to set:

- `GITHUB_WEBHOOK_SECRET` to a random secret shared with your GitHub App.
- At least one `AMP_ALLOWED_WORKSPACE_IDS`, `AMP_ALLOWED_PROJECT_IDS`, or `AMP_ALLOWED_USER_IDS`
  allowlist.
- `AMP_OIDC_AUDIENCE` to the audience configured in the plugin.
- `AMP_WEBHOOK_ALLOWED_HOSTS` to the host or parent domain used by Amp durable webhooks.

Start the bridge with:

```sh
mise exec -- bun run start
```

Use `GET /healthz` as its health check and keep `DATABASE_PATH` on persistent storage in production.
Create a GitHub App whose webhook points to `https://your-bridge.example/github/webhook`, then
install it on the repositories you want to watch. [GitHub App setup](docs/github-app.md) lists the
required events and read-only permissions.

The included `fly.toml` shows one Fly.io deployment. Before deploying a copy, change its app name,
region, and OIDC audience, then create the app and set its secrets:

```sh
APP=your-amp-subscribe-app
mise exec -- flyctl apps create "$APP"
mise exec -- flyctl secrets set --app "$APP" \
  GITHUB_WEBHOOK_SECRET=... AMP_ALLOWED_WORKSPACE_IDS=...
mise exec -- flyctl deploy --remote-only --app "$APP"
```

## Security

The subscription API authenticates Amp with short-lived workload identity tokens and derives the
thread owner from the signed identity. GitHub webhooks are signature-checked, delivery IDs are
deduplicated, and outbound delivery is restricted to configured HTTPS hosts.

amp-subscribe forwards bounded event metadata, not untrusted PR titles, comments, check output,
commit messages, patches, or filenames. Amp fetches that content through its normal GitHub tools
when it investigates an event.

## Development

```sh
mise run ci
```
