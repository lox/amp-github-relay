import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { githubAppManifest, setEnvValue, writeEnvValue } from "../scripts/setup-github-app"

describe("GitHub App setup", () => {
  test("builds a webhook-only manifest for all routed GitHub events", () => {
    expect(githubAppManifest("https://subscribe.example.com/bridge", "http://127.0.0.1:1234/callback")).toEqual({
      name: "amp-subscribe",
      url: "https://subscribe.example.com/bridge",
      description: "Routes GitHub events to subscribed Amp threads",
      redirect_url: "http://127.0.0.1:1234/callback",
      public: false,
      hook_attributes: { url: "https://subscribe.example.com/bridge/github/webhook", active: true },
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
      .toBe("PORT=3000\nAMP_OIDC_AUDIENCE=test\nGITHUB_WEBHOOK_SECRET=new\n")
    expect(setEnvValue("PORT=3000", "GITHUB_WEBHOOK_SECRET", "new"))
      .toBe("PORT=3000\nGITHUB_WEBHOOK_SECRET=new\n")
    expect(setEnvValue("GITHUB_WEBHOOK_SECRET=old-1\nPORT=3000\nGITHUB_WEBHOOK_SECRET=old-2\n", "GITHUB_WEBHOOK_SECRET", "new"))
      .toBe("PORT=3000\nGITHUB_WEBHOOK_SECRET=new\n")
  })

  test("atomically stores the secret in a restricted env file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amp-subscribe-"))
    const path = join(directory, ".env")
    try {
      await writeFile(path, "PORT=3000\n", { mode: 0o644 })
      await writeEnvValue(path, "GITHUB_WEBHOOK_SECRET", "secret")

      expect(await readFile(path, "utf8")).toBe("PORT=3000\nGITHUB_WEBHOOK_SECRET=secret\n")
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
