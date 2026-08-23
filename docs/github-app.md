# GitHub App setup

Create one GitHub App for the amp-subscribe deployment.

## Webhook

- URL: `https://lox-amp-subscribe.fly.dev/github/webhook`
- Secret: the value deployed as `GITHUB_WEBHOOK_SECRET`
- Active: enabled

Subscribe to these repository events:

- Push, for branch subscriptions
- Pull requests
- Pull request reviews
- Pull request review comments
- Issue comments
- Check runs or check suites
- Workflow runs, if Actions-level notifications are wanted

## Permissions

amp-subscribe only receives webhooks, so request read-only access to:

- Metadata
- Contents
- Pull requests
- Issues
- Checks
- Actions, if workflow runs are enabled

Install the app on the repositories whose events should be routed. amp-subscribe does not need the
App private key until it starts calling GitHub's API itself.

Orb subscription requests are separate from GitHub authentication. They use short-lived Amp OIDC
tokens with audience `urn:lox:amp-subscribe`; the service must restrict at least one immutable
Amp workspace, project, or user ID. The checked-in Fly configuration also accepts the legacy
`urn:lox:amp-github-relay` audience during the rename migration.
