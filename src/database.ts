import { Database } from "bun:sqlite"
import type { Subscription, SubscriptionBehavior, SubscriptionEvent } from "./types"

type WithoutStoredFields<T> = T extends unknown ? Omit<T, "id" | "createdAt"> : never
type SubscriptionInput = WithoutStoredFields<Subscription>

interface SubscriptionRow {
  id: string
  thread_id: string
  repository: string
  target_type: "pull_request" | "branch"
  target: string
  webhook_url: string
  events: string
  behavior: SubscriptionBehavior
  created_at: string
}

function mapSubscription(row: SubscriptionRow): Subscription {
  const common = {
    id: row.id,
    threadId: row.thread_id,
    repository: row.repository,
    webhookUrl: row.webhook_url,
    events: JSON.parse(row.events) as SubscriptionEvent[],
    behavior: row.behavior,
    createdAt: row.created_at,
  }
  return row.target_type === "pull_request"
    ? { ...common, targetType: "pull_request", pullRequestNumber: Number(row.target) }
    : { ...common, targetType: "branch", branch: row.target }
}

export class RelayDatabase {
  readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA foreign_keys = ON")
    const legacy = this.sqlite.query<{ name: string }, []>("PRAGMA table_info(subscriptions)")
      .all().some((column) => column.name === "pull_request_number")
    if (legacy) this.migratePullRequestSubscriptions()
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('pull_request', 'branch')),
        target TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        events TEXT NOT NULL,
        behavior TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, repository, target_type, target)
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        subscription_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        event TEXT NOT NULL,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY(subscription_id, delivery_id, event),
        FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
      );
    `)
  }

  private migratePullRequestSubscriptions(): void {
    this.sqlite.exec("PRAGMA foreign_keys = OFF")
    this.sqlite.transaction(() => {
      this.sqlite.exec(`
        ALTER TABLE deliveries RENAME TO deliveries_legacy;
        ALTER TABLE subscriptions RENAME TO subscriptions_legacy;
        CREATE TABLE subscriptions (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          repository TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK(target_type IN ('pull_request', 'branch')),
          target TEXT NOT NULL,
          webhook_url TEXT NOT NULL,
          events TEXT NOT NULL,
          behavior TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(thread_id, repository, target_type, target)
        );
        CREATE TABLE deliveries (
          subscription_id TEXT NOT NULL,
          delivery_id TEXT NOT NULL,
          event TEXT NOT NULL,
          delivered_at TEXT NOT NULL,
          PRIMARY KEY(subscription_id, delivery_id, event),
          FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
        );
        INSERT INTO subscriptions
          (id, thread_id, repository, target_type, target, webhook_url, events, behavior, created_at)
        SELECT id, thread_id, repository, 'pull_request', CAST(pull_request_number AS TEXT),
          webhook_url, events, behavior, created_at
        FROM subscriptions_legacy;
        INSERT INTO deliveries SELECT * FROM deliveries_legacy;
        DROP TABLE deliveries_legacy;
        DROP TABLE subscriptions_legacy;
      `)
    })()
    this.sqlite.exec("PRAGMA foreign_keys = ON")
  }

  upsert(input: SubscriptionInput): Subscription {
    const target = input.targetType === "pull_request" ? String(input.pullRequestNumber) : input.branch
    const existing = this.sqlite.query<SubscriptionRow, [string, string, string, string]>(`
      SELECT * FROM subscriptions
      WHERE thread_id = ? AND repository = ? AND target_type = ? AND target = ?
    `).get(input.threadId, input.repository, input.targetType, target)
    const stored = {
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.created_at ?? new Date().toISOString(),
    }
    const subscription: Subscription = input.targetType === "pull_request"
      ? { ...input, ...stored }
      : { ...input, ...stored }
    this.sqlite.query(`
      INSERT INTO subscriptions
        (id, thread_id, repository, target_type, target, webhook_url, events, behavior, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, repository, target_type, target) DO UPDATE SET
        webhook_url = excluded.webhook_url,
        events = excluded.events,
        behavior = excluded.behavior
    `).run(
      subscription.id,
      subscription.threadId,
      subscription.repository,
      subscription.targetType,
      target,
      subscription.webhookUrl,
      JSON.stringify(subscription.events),
      subscription.behavior,
      subscription.createdAt,
    )
    return subscription
  }

  list(threadId: string): Subscription[] {
    return this.sqlite.query<SubscriptionRow, [string]>(
      "SELECT * FROM subscriptions WHERE thread_id = ? ORDER BY created_at",
    ).all(threadId).map(mapSubscription)
  }

  matching(repository: string, targetType: Subscription["targetType"], target: string, event: SubscriptionEvent): Subscription[] {
    return this.sqlite.query<SubscriptionRow, [string, string, string]>(`
      SELECT * FROM subscriptions WHERE repository = ? AND target_type = ? AND target = ?
    `).all(repository.toLowerCase(), targetType, target).map(mapSubscription)
      .filter((subscription) => subscription.events.includes(event))
  }

  delete(threadId: string, id: string): boolean {
    return this.sqlite.query("DELETE FROM subscriptions WHERE id = ? AND thread_id = ?").run(id, threadId).changes > 0
  }

  wasDelivered(subscriptionId: string, deliveryId: string, event: string): boolean {
    return this.sqlite.query(`
      SELECT 1 FROM deliveries WHERE subscription_id = ? AND delivery_id = ? AND event = ?
    `).get(subscriptionId, deliveryId, event) !== null
  }

  markDelivered(subscriptionId: string, deliveryId: string, event: string): void {
    this.sqlite.query(`
      INSERT OR IGNORE INTO deliveries (subscription_id, delivery_id, event, delivered_at)
      VALUES (?, ?, ?, ?)
    `).run(subscriptionId, deliveryId, event, new Date().toISOString())
  }

  close(): void {
    this.sqlite.close()
  }
}
