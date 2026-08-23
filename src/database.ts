import { Database } from "bun:sqlite"
import type { Subscription, SubscriptionBehavior, SubscriptionEvent } from "./types"

interface SubscriptionRow {
  id: string
  thread_id: string
  repository: string
  pull_request_number: number
  webhook_url: string
  events: string
  behavior: SubscriptionBehavior
  created_at: string
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    threadId: row.thread_id,
    repository: row.repository,
    pullRequestNumber: row.pull_request_number,
    webhookUrl: row.webhook_url,
    events: JSON.parse(row.events) as SubscriptionEvent[],
    behavior: row.behavior,
    createdAt: row.created_at,
  }
}

export class RelayDatabase {
  readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA foreign_keys = ON")
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        pull_request_number INTEGER NOT NULL,
        webhook_url TEXT NOT NULL,
        events TEXT NOT NULL,
        behavior TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, repository, pull_request_number)
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

  upsert(input: Omit<Subscription, "id" | "createdAt">): Subscription {
    const existing = this.sqlite.query<SubscriptionRow, [string, string, number]>(`
      SELECT * FROM subscriptions
      WHERE thread_id = ? AND repository = ? AND pull_request_number = ?
    `).get(input.threadId, input.repository, input.pullRequestNumber)
    const subscription: Subscription = {
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.created_at ?? new Date().toISOString(),
    }
    this.sqlite.query(`
      INSERT INTO subscriptions
        (id, thread_id, repository, pull_request_number, webhook_url, events, behavior, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, repository, pull_request_number) DO UPDATE SET
        webhook_url = excluded.webhook_url,
        events = excluded.events,
        behavior = excluded.behavior
    `).run(
      subscription.id,
      subscription.threadId,
      subscription.repository,
      subscription.pullRequestNumber,
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

  matching(repository: string, pullRequestNumber: number, event: SubscriptionEvent): Subscription[] {
    return this.sqlite.query<SubscriptionRow, [string, number]>(`
      SELECT * FROM subscriptions WHERE repository = ? AND pull_request_number = ?
    `).all(repository.toLowerCase(), pullRequestNumber).map(mapSubscription)
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
