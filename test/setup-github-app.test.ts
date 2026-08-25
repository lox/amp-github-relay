import { describe, expect, test } from "bun:test"
import { githubAppManifest, setEnvValue } from "../scripts/setup-github-app"

describe("GitHub App setup", () => {
  test("builds a webhook-only manifest for all routed GitHub events", () => {
    expect(githubAppManifest("https://subscribe.example.com", "http://127.0.0.1:1234/callback")).toEqual({
      name: "amp-subscribe",
      url: "https://subscribe.example.com",
      description: "Routes GitHub events to subscribed Amp threads",
      redirect_url: "http://127.0.0.1:1234/callback",
      public: false,
      hook_attributes: { url: "https://subscribe.example.com/github/webhook", active: true },
      default_permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
        issues: "read",
        checks: "read",
        actions: "read",
      },
      default_events: [
        "push",
        "pull_request",
        "pull_request_review",
        "pull_request_review_comment",
        "issue_comment",
        "check_run",
        "check_suite",
        "workflow_run",
      ],
    })
  })

  test("replaces or appends the webhook secret without touching other settings", () => {
    expect(setEnvValue("PORT=3000\nGITHUB_WEBHOOK_SECRET=old\nAMP_OIDC_AUDIENCE=test\n", "GITHUB_WEBHOOK_SECRET", "new"))
      .toBe("PORT=3000\nGITHUB_WEBHOOK_SECRET=new\nAMP_OIDC_AUDIENCE=test\n")
    expect(setEnvValue("PORT=3000", "GITHUB_WEBHOOK_SECRET", "new"))
      .toBe("PORT=3000\nGITHUB_WEBHOOK_SECRET=new\n")
  })
})
