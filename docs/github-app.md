# GitHub App setup

Create one GitHub App for the relay deployment.

## Webhook

- URL: `https://<relay-host>/github/webhook`
- Secret: the value deployed as `GITHUB_WEBHOOK_SECRET`
- Active: enabled

Subscribe to these repository events:

- Pull requests
- Pull request reviews
- Pull request review comments
- Issue comments
- Check runs or check suites
- Workflow runs, if Actions-level notifications are wanted

## Permissions

The MVP only receives webhooks, so request read-only access to:

- Metadata
- Pull requests
- Issues
- Checks
- Actions, if workflow runs are enabled

Install the app on the repositories whose events should be routed. The relay does not need the
App private key until it starts calling GitHub's API itself.
