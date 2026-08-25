import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { OrbIdentity } from "./auth"
import { verifyHmac } from "./crypto"
import { SubscriptionDatabase } from "./database"
import { normalizeGitHubEvent } from "./events"
import { fetchFeed, type FetchedFeed } from "./feeds"
import {
  subscriptionEvents,
  type SubscriptionBehavior,
  type SubscriptionEvent,
} from "./types"

export interface SubscriptionBridgeConfig {
  databasePath: string
  githubWebhookSecret: string
  allowedWebhookHosts: string[]
  authenticate: (request: Request) => Promise<OrbIdentity>
  fetchFeed?: (url: string, conditional?: { etag?: string | null; lastModified?: string | null }) => Promise<FetchedFeed>
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function isAllowedWebhookUrl(value: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && allowedHosts.some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  } catch {
    return false
  }
}

function validEvents(value: unknown): value is SubscriptionEvent[] {
  return Array.isArray(value) && value.length > 0 && value.every((event) =>
    typeof event === "string" && subscriptionEvents.includes(event as SubscriptionEvent),
  )
}

function validBehavior(value: unknown): value is SubscriptionBehavior {
  return value === "notify" || value === "investigate" || value === "implement"
}

function validBranch(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255
    && /^[!-~]+$/.test(value)
    && value !== "@" && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".")
    && !value.includes("..") && !value.includes("//") && !value.includes("@{")
    && !/[\u0000-\u0020\u007f~^:?*\\[]/.test(value)
    && value.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"))
}

export function createSubscriptionBridge(config: SubscriptionBridgeConfig) {
  if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true })
  const database = new SubscriptionDatabase(config.databasePath)
  const feedFetcher = config.fetchFeed ?? fetchFeed

  async function subscriptions(request: Request): Promise<Response> {
    const identity = await config.authenticate(request).catch(() => null)
    if (!identity) return json({ error: "unauthorized" }, 401)

    if (request.method === "GET") {
      return json({ subscriptions: database.list(identity.threadId).map(({ webhookUrl: _, ...item }) => item) })
    }

    if (request.method === "POST") {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      const repository = typeof input?.repository === "string" ? input.repository.toLowerCase() : ""
      const targetType = input?.targetType ?? (input?.pullRequestNumber === undefined ? undefined : "pull_request")
      const pullRequestNumber = input?.pullRequestNumber
      const branch = input?.branch
      const webhookUrl = input?.webhookUrl
      const events = input?.events
      const behavior = input?.behavior
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) return json({ error: "invalid repository" }, 400)
      if (targetType !== "pull_request" && targetType !== "branch") {
        return json({ error: "invalid targetType" }, 400)
      }
      if (targetType === "pull_request" && (!Number.isInteger(pullRequestNumber) || (pullRequestNumber as number) < 1)) {
        return json({ error: "invalid pullRequestNumber" }, 400)
      }
      if (targetType === "branch" && !validBranch(branch)) {
        return json({ error: "invalid branch" }, 400)
      }
      if (typeof webhookUrl !== "string" || !isAllowedWebhookUrl(webhookUrl, config.allowedWebhookHosts)) {
        return json({ error: "webhookUrl host is not allowed" }, 400)
      }
      if (!validEvents(events)) return json({ error: "invalid events" }, 400)
      if (targetType === "branch" && events.some((event) => event !== "commits" && event !== "checks")) {
        return json({ error: "branch subscriptions support only commits and checks" }, 400)
      }
      if (!validBehavior(behavior)) return json({ error: "invalid behavior" }, 400)
      const common = {
        threadId: identity.threadId,
        repository,
        webhookUrl,
        events,
        behavior,
      }
      const subscription = targetType === "pull_request"
        ? database.upsert({ ...common, targetType, pullRequestNumber: pullRequestNumber as number })
        : database.upsert({ ...common, targetType, branch: branch as string })
      const { webhookUrl: _, ...safeSubscription } = subscription
      return json({ subscription: safeSubscription }, 201)
    }

    if (request.method === "DELETE") {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      if (typeof input?.id !== "string") {
        return json({ error: "id is required" }, 400)
      }
      return database.delete(identity.threadId, input.id)
        ? new Response(null, { status: 204 })
        : json({ error: "subscription not found" }, 404)
    }

    return json({ error: "method not allowed" }, 405)
  }

  async function githubWebhook(request: Request): Promise<Response> {
    const body = new Uint8Array(await request.arrayBuffer())
    const signature = request.headers.get("x-hub-signature-256") ?? ""
    if (!await verifyHmac(config.githubWebhookSecret, body, signature)) {
      return json({ error: "invalid signature" }, 401)
    }
    const eventName = request.headers.get("x-github-event") ?? ""
    const deliveryId = request.headers.get("x-github-delivery") ?? ""
    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(body)) as unknown
    } catch {
      return json({ error: "invalid JSON" }, 400)
    }
    const events = normalizeGitHubEvent(eventName, deliveryId, payload)
    let delivered = 0
    let failed = 0
    let removed = 0

    for (const event of events) {
      const target = event.targetType === "pull_request"
        ? String(event.pullRequest.number)
        : event.branch.name
      const idempotencyKey = event.targetType === "pull_request"
        ? `${deliveryId}:${event.event}:${event.repository.id}:${target}`
        : `${deliveryId}:${event.event}:${event.repository.id}:branch:${encodeURIComponent(target)}`
      for (const subscription of database.matching(
        event.repository.fullName,
        event.targetType,
        target,
        event.event,
      )) {
        if (database.wasDelivered(subscription.id, deliveryId, event.event)) continue
        const forwardedBody = JSON.stringify({ ...event, behavior: subscription.behavior })
        let response: Response
        try {
          response = await fetch(subscription.webhookUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": idempotencyKey,
            },
            body: forwardedBody,
            signal: AbortSignal.timeout(10_000),
          })
        } catch {
          failed += 1
          continue
        }
        if (response.status === 404 || response.status === 410) {
          database.delete(subscription.threadId, subscription.id)
          removed += 1
          continue
        }
        if (!response.ok) {
          failed += 1
          continue
        }
        database.markDelivered(subscription.id, deliveryId, event.event)
        delivered += 1
      }
    }
    if (failed > 0) {
      return json({ error: "Amp webhook delivery failed", failed, delivered, removed }, 502)
    }
    return json({ accepted: true, matchedEvents: events.length, delivered, removed }, 202)
  }

  async function feedSubscriptions(request: Request): Promise<Response> {
    const identity = await config.authenticate(request).catch(() => null)
    if (!identity) return json({ error: "unauthorized" }, 401)

    if (request.method === "GET") {
      const subscriptions = database.listFeeds(identity.threadId).map(({
        webhookUrl: _, etag: __, lastModified: ___, ...item
      }) => item)
      return json({ subscriptions })
    }

    if (request.method === "POST") {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      const feedUrl = input?.feedUrl
      const webhookUrl = input?.webhookUrl
      const behavior = input?.behavior
      if (typeof feedUrl !== "string") return json({ error: "feedUrl is required" }, 400)
      if (typeof webhookUrl !== "string" || !isAllowedWebhookUrl(webhookUrl, config.allowedWebhookHosts)) {
        return json({ error: "webhookUrl host is not allowed" }, 400)
      }
      if (!validBehavior(behavior)) return json({ error: "invalid behavior" }, 400)
      let fetched: FetchedFeed
      let canonicalUrl: string
      try {
        const url = new URL(feedUrl)
        url.hash = ""
        canonicalUrl = url.href
        fetched = await feedFetcher(feedUrl)
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not read feed" }, 400)
      }
      if (!fetched.feed) return json({ error: "Feed returned no content" }, 400)
      const subscription = database.upsertFeed({
        threadId: identity.threadId,
        feedUrl: canonicalUrl,
        webhookUrl,
        behavior,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      }, fetched.feed.entries)
      const { webhookUrl: _, etag: __, lastModified: ___, ...safeSubscription } = subscription
      return json({ subscription: safeSubscription }, 201)
    }

    if (request.method === "DELETE") {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      if (typeof input?.id !== "string") return json({ error: "id is required" }, 400)
      return database.deleteFeed(identity.threadId, input.id)
        ? new Response(null, { status: 204 })
        : json({ error: "subscription not found" }, 404)
    }

    return json({ error: "method not allowed" }, 405)
  }

  let polling = false
  async function pollFeeds(): Promise<{ checked: number; delivered: number; failed: number; removed: number }> {
    if (polling) return { checked: 0, delivered: 0, failed: 0, removed: 0 }
    polling = true
    let checked = 0
    let delivered = 0
    let failed = 0
    let removed = 0
    try {
      for (const subscription of database.allFeeds()) {
        checked += 1
        let fetched: FetchedFeed
        try {
          fetched = await feedFetcher(subscription.feedUrl, {
            etag: subscription.etag,
            lastModified: subscription.lastModified,
          })
        } catch {
          failed += 1
          continue
        }
        if (!fetched.feed) continue
        let feedFailed = false
        for (const entry of [...fetched.feed.entries].reverse()) {
          if (!database.feedEntryChanged(subscription.id, entry)) continue
          const body = JSON.stringify({
            schemaVersion: 1,
            source: "feed",
            feed: { title: fetched.feed.title, url: subscription.feedUrl },
            entry: {
              id: entry.id,
              title: entry.title,
              url: entry.url,
              publishedAt: entry.publishedAt,
              updatedAt: entry.updatedAt,
            },
            behavior: subscription.behavior,
          })
          let response: Response
          try {
            response = await fetch(subscription.webhookUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": `feed:${subscription.id}:${entry.fingerprint}`,
              },
              body,
              signal: AbortSignal.timeout(10_000),
            })
          } catch {
            failed += 1
            feedFailed = true
            continue
          }
          if (response.status === 404 || response.status === 410) {
            database.deleteFeed(subscription.threadId, subscription.id)
            removed += 1
            break
          }
          if (!response.ok) {
            failed += 1
            feedFailed = true
            continue
          }
          database.storeFeedEntry(subscription.id, entry)
          delivered += 1
        }
        if (!feedFailed) database.updateFeedCache(subscription.id, fetched.etag, fetched.lastModified)
      }
      return { checked, delivered, failed, removed }
    } finally {
      polling = false
    }
  }

  return {
    database,
    pollFeeds,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/healthz") return json({ ok: true })
      if (url.pathname === "/api/subscriptions") return subscriptions(request)
      if (url.pathname === "/api/feed-subscriptions") return feedSubscriptions(request)
      if (request.method === "POST" && url.pathname === "/github/webhook") return githubWebhook(request)
      return json({ error: "not found" }, 404)
    },
  }
}
