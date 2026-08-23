export const subscriptionEvents = [
  "pull_requests",
  "commits",
  "reviews",
  "review_comments",
  "discussion_comments",
  "checks",
  "merged",
  "closed",
] as const

export type SubscriptionEvent = (typeof subscriptionEvents)[number]
export type SubscriptionBehavior = "notify" | "investigate" | "implement"

export interface Subscription {
  id: string
  threadId: string
  repository: string
  pullRequestNumber: number
  webhookUrl: string
  events: SubscriptionEvent[]
  behavior: SubscriptionBehavior
  createdAt: string
}

export interface RoutedEvent {
  schemaVersion: 1
  deliveryId: string
  githubEvent: string
  event: SubscriptionEvent
  action: string
  repository: {
    id: number
    fullName: string
  }
  pullRequest: {
    number: number
    url: string
  }
  sender: string | null
  occurredAt: string
}
