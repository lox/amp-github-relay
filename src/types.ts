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

export type CheckStatus = "requested" | "waiting" | "pending" | "queued" | "in_progress" | "completed"
export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure"
  | "success"
  | "timed_out"

export type RoutedEventDetail =
  | {
      kind: "pull_request"
      state?: "open" | "closed"
      draft?: boolean
      merged?: boolean
      headSha?: string
      beforeSha?: string
      afterSha?: string
      requestedReviewer?: string
      requestedTeam?: string
      assignee?: string
    }
  | {
      kind: "pull_request_review"
      id: number
      url: string
      state?: "approved" | "changes_requested" | "commented" | "dismissed" | "pending"
      author?: string
      commitSha?: string
      submittedAt?: string
    }
  | {
      kind: "pull_request_review_comment"
      id: number
      url: string
      author?: string
      createdAt?: string
      updatedAt?: string
      inReplyToId?: number
      line?: number
      startLine?: number
      side?: "LEFT" | "RIGHT"
      startSide?: "LEFT" | "RIGHT"
    }
  | {
      kind: "issue_comment"
      id: number
      url: string
      author?: string
      createdAt?: string
      updatedAt?: string
    }
  | {
      kind: "check_run"
      id: number
      url?: string
      status?: CheckStatus
      conclusion?: CheckConclusion | null
      headSha?: string
      appSlug?: string
      startedAt?: string
      completedAt?: string
    }
  | {
      kind: "check_suite"
      id: number
      apiPath: string
      status?: CheckStatus
      conclusion?: CheckConclusion | null
      headSha?: string
      appSlug?: string
    }
  | {
      kind: "workflow_run"
      id: number
      workflowId?: number
      url?: string
      status?: CheckStatus
      conclusion?: CheckConclusion | null
      triggerEvent?: string
      runNumber?: number
      runAttempt?: number
      headSha?: string
      createdAt?: string
      runStartedAt?: string
      updatedAt?: string
    }

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
  detail?: RoutedEventDetail
}
