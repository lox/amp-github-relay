# GitHub App setup

Create one GitHub App for the amp-subscribe deployment.

The easiest setup uses GitHub's App Manifest flow:

```sh
mise run setup-github-app
```

Give the command the public origin of your deployed bridge, such as `https://subscribe.example.com`.
It creates a private GitHub App with the settings below, writes GitHub's generated webhook secret
to `.env`, and links to the installation page. The generated private key and client secret are
deliberately not stored because amp-subscribe does not call GitHub's API.

The rest of this page describes the equivalent manual setup.

## Webhook

- URL: `https://your-bridge.example/github/webhook`
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
tokens with the audience configured by the deployment; the service must restrict at least one
immutable Amp workspace, project, or user ID.
