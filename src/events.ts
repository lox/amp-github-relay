import type { RoutedEvent, SubscriptionEvent } from "./types"

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function classify(eventName: string, action: string, pullRequest: JsonObject): SubscriptionEvent | null {
  if (eventName === "pull_request") {
    if (action === "synchronize") return "commits"
    if (action === "closed") return pullRequest.merged === true ? "merged" : "closed"
    return "pull_requests"
  }
  if (eventName === "pull_request_review") return "reviews"
  if (eventName === "pull_request_review_comment") return "review_comments"
  if (eventName === "issue_comment") return "discussion_comments"
  if (eventName === "check_run" || eventName === "check_suite" || eventName === "workflow_run") {
    return "checks"
  }
  return null
}

function pullRequestsFor(eventName: string, payload: JsonObject): JsonObject[] {
  const pullRequest = object(payload.pull_request)
  if (pullRequest) return [pullRequest]

  if (eventName === "issue_comment") {
    const issue = object(payload.issue)
    if (!issue || !object(issue.pull_request)) return []
    return [{ number: issue.number, html_url: object(issue.pull_request)?.html_url }]
  }

  const container = object(payload.check_run) ?? object(payload.check_suite) ?? object(payload.workflow_run)
  if (!container || !Array.isArray(container.pull_requests)) return []
  return container.pull_requests.flatMap((value) => (object(value) ? [object(value)!] : []))
}

export function normalizeGitHubEvent(
  eventName: string,
  deliveryId: string,
  payload: unknown,
): RoutedEvent[] {
  const root = object(payload)
  const repository = object(root?.repository)
  const repositoryId = number(repository?.id)
  const fullName = string(repository?.full_name)
  if (!root || !repository || repositoryId === null || !fullName || !deliveryId) return []

  const action = string(root.action) ?? eventName
  const sender = string(object(root.sender)?.login)
  const occurredAt = new Date().toISOString()

  return pullRequestsFor(eventName, root).flatMap((pullRequest) => {
    const pullRequestNumber = number(pullRequest.number)
    const url = string(pullRequest.html_url) ?? `https://github.com/${fullName}/pull/${pullRequestNumber}`
    const event = classify(eventName, action, pullRequest)
    if (pullRequestNumber === null || !event) return []
    return [{
      schemaVersion: 1,
      deliveryId,
      githubEvent: eventName,
      event,
      action,
      repository: { id: repositoryId, fullName },
      pullRequest: { number: pullRequestNumber, url },
      sender,
      occurredAt,
    }]
  })
}
