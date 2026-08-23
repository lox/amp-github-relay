import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createRelay } from "../src/app"
import { hmacSha256 } from "../src/crypto"

const config = {
  databasePath: ":memory:",
  githubWebhookSecret: "github-secret",
  allowedWebhookHosts: ["example.test"],
  authenticate: async (request: Request) => {
    if (request.headers.get("authorization") !== "Bearer oidc-token") throw new Error("unauthorized")
    return { threadId: "T-test", workspaceId: "W-test", projectId: "P-test", userId: "U-test" }
  },
}

const openRelays: ReturnType<typeof createRelay>[] = []

afterEach(() => {
  for (const relay of openRelays.splice(0)) relay.database.close()
  mock.restore()
})

function relay() {
  const instance = createRelay(config)
  openRelays.push(instance)
  return instance
}

function apiRequest(body: unknown, method = "POST") {
  return new Request("https://relay.test/api/subscriptions", {
    method,
    headers: { authorization: "Bearer oidc-token", "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  })
}

describe("relay", () => {
  test("requires API authentication", async () => {
    const response = await relay().fetch(new Request("https://relay.test/api/subscriptions"))
    expect(response.status).toBe(401)
  })

  test("registers without exposing the capability URL", async () => {
    const app = relay()
    const response = await app.fetch(apiRequest({
      threadId: "T-attacker-controlled",
      repository: "lox/project",
      pullRequestNumber: 17,
      webhookUrl: "https://hooks.example.test/secret-capability",
      events: ["reviews"],
      behavior: "investigate",
    }))
    expect(response.status).toBe(201)
    expect(await response.text()).not.toContain("secret-capability")
    expect(app.database.list("T-test")).toHaveLength(1)
    expect(app.database.list("T-attacker-controlled")).toHaveLength(0)
  })

  test("verifies, routes, and deduplicates a GitHub delivery", async () => {
    const app = relay()
    await app.fetch(apiRequest({
      threadId: "T-test",
      repository: "lox/project",
      pullRequestNumber: 17,
      webhookUrl: "https://hooks.example.test/secret-capability",
      events: ["reviews"],
      behavior: "investigate",
    }))
    const forwarded: Array<{ body: string; idempotencyKey: string | null }> = []
    const fetchSpy = spyOn(globalThis, "fetch")
    fetchSpy.mockImplementation((async (_input, init) => {
      forwarded.push({
        body: String(init?.body),
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      })
      return new Response(null, { status: 202 })
    }) as typeof fetch)
    const body = JSON.stringify({
      action: "submitted",
      repository: { id: 42, full_name: "lox/project" },
      pull_request: { number: 17, html_url: "https://github.com/lox/project/pull/17" },
      sender: { login: "reviewer" },
      review: {
        id: 91,
        html_url: "https://github.com/lox/project/pull/17#pullrequestreview-91",
        state: "approved",
        user: { login: "reviewer" },
        body: "UNTRUSTED_SENTINEL",
      },
    })
    const request = async () => app.fetch(new Request("https://relay.test/github/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": await hmacSha256("github-secret", body),
        "x-github-event": "pull_request_review",
        "x-github-delivery": "delivery-1",
      },
      body,
    }))

    expect((await request()).status).toBe(202)
    expect((await request()).status).toBe(202)
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]?.idempotencyKey).toBe("delivery-1:reviews:42:17")
    expect(JSON.parse(forwarded[0]!.body)).toMatchObject({
      schemaVersion: 1,
      behavior: "investigate",
      detail: {
        kind: "pull_request_review",
        id: 91,
        url: "https://github.com/lox/project/pull/17#pullrequestreview-91",
        state: "approved",
        author: "reviewer",
      },
    })
    expect(forwarded[0]?.body).not.toContain("UNTRUSTED_SENTINEL")
  })

  test("rejects an invalid GitHub signature", async () => {
    const response = await relay().fetch(new Request("https://relay.test/github/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=bad",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-1",
      },
      body: "{}",
    }))
    expect(response.status).toBe(401)
  })
})
