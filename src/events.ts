import {
  checkConclusions,
  checkStatuses,
  type CheckConclusion,
  type CheckStatus,
  type RoutedEvent,
  type RoutedEventDetail,
  type SubscriptionEvent,
} from "./types"

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && values.includes(value as T[number]) ? value as T[number] : undefined
}

function lowerEnumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" ? enumValue(value.toLowerCase(), values) : undefined
}

function sha(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value) ? value : undefined
}

function principal(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 100
    && /^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/.test(value) ? value : undefined
}

function triggerName(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : undefined
}

function repositoryName(value: unknown): string | null {
  return typeof value === "string" && value.length <= 201
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? value : null
}

function branchName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 255
    || value === "@" || value.startsWith("/") || value.endsWith("/") || value.endsWith(".")
    || value.includes("..") || value.includes("//") || value.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*\\[]/.test(value)
    || value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) return null
  return value
}

function branchUrl(fullName: string, branch: string): string {
  return `https://github.com/${fullName}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`
}

function githubUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "github.com" && url.port === ""
      && url.username === "" && url.password === "" ? url.href : undefined
  } catch {
    return undefined
  }
}

function checkStatus(value: unknown): CheckStatus | undefined {
  return enumValue(value, checkStatuses)
}

function checkConclusion(value: unknown): CheckConclusion | null | undefined {
  return value === null ? null : enumValue(value, checkConclusions)
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

function branchFor(eventName: string, payload: JsonObject): string | null {
  if (eventName === "push") {
    return typeof payload.ref === "string" && payload.ref.startsWith("refs/heads/")
      ? branchName(payload.ref.slice("refs/heads/".length))
      : null
  }
  const container = object(payload.check_run) ?? object(payload.check_suite) ?? object(payload.workflow_run)
  if (!container) return null
  return branchName(object(container.check_suite)?.head_branch ?? container.head_branch)
}

function detailFor(eventName: string, payload: JsonObject, fullName: string): RoutedEventDetail | undefined {
  let detail: RoutedEventDetail | undefined
  const pullRequestNumber = positiveNumber(object(payload.pull_request)?.number)
    ?? positiveNumber(object(payload.issue)?.number)

  if (eventName === "pull_request") {
    const pullRequest = object(payload.pull_request)
    if (!pullRequest) return undefined
    const value: Extract<RoutedEventDetail, { kind: "pull_request" }> = { kind: "pull_request" }
    const state = enumValue(pullRequest.state, ["open", "closed"] as const)
    const draft = boolean(pullRequest.draft)
    const merged = boolean(pullRequest.merged)
    const headSha = sha(object(pullRequest.head)?.sha)
    const beforeSha = sha(payload.before)
    const afterSha = sha(payload.after)
    const requestedReviewer = principal(object(payload.requested_reviewer)?.login)
    const requestedTeam = principal(object(payload.requested_team)?.slug)
    const assignee = principal(object(payload.assignee)?.login)
    if (state) value.state = state
    if (draft !== undefined) value.draft = draft
    if (merged !== undefined) value.merged = merged
    if (headSha) value.headSha = headSha
    if (beforeSha) value.beforeSha = beforeSha
    if (afterSha) value.afterSha = afterSha
    if (requestedReviewer) value.requestedReviewer = requestedReviewer
    if (requestedTeam) value.requestedTeam = requestedTeam
    if (assignee) value.assignee = assignee
    detail = value
  } else if (eventName === "push") {
    const value: Extract<RoutedEventDetail, { kind: "push" }> = { kind: "push" }
    const beforeSha = sha(payload.before)
    const afterSha = sha(payload.after)
    const forced = boolean(payload.forced)
    const created = boolean(payload.created)
    const deleted = boolean(payload.deleted)
    if (beforeSha) value.beforeSha = beforeSha
    if (afterSha) value.afterSha = afterSha
    if (forced !== undefined) value.forced = forced
    if (created !== undefined) value.created = created
    if (deleted !== undefined) value.deleted = deleted
    detail = value
  } else if (eventName === "pull_request_review") {
    const review = object(payload.review)
    const id = positiveNumber(review?.id)
    if (review && id && pullRequestNumber) {
      const value: Extract<RoutedEventDetail, { kind: "pull_request_review" }> = {
        kind: "pull_request_review",
        id,
        url: `https://github.com/${fullName}/pull/${pullRequestNumber}#pullrequestreview-${id}`,
      }
      const state = lowerEnumValue(review.state, ["approved", "changes_requested", "commented", "dismissed", "pending"] as const)
      const author = principal(object(review.user)?.login)
      const commitSha = sha(review.commit_id)
      if (state) value.state = state
      if (author) value.author = author
      if (commitSha) value.commitSha = commitSha
      detail = value
    }
  } else if (eventName === "pull_request_review_comment") {
    const comment = object(payload.comment)
    const id = positiveNumber(comment?.id)
    if (comment && id && pullRequestNumber) {
      const value: Extract<RoutedEventDetail, { kind: "pull_request_review_comment" }> = {
        kind: "pull_request_review_comment",
        id,
        url: `https://github.com/${fullName}/pull/${pullRequestNumber}#discussion_r${id}`,
      }
      const author = principal(object(comment.user)?.login)
      const inReplyToId = positiveNumber(comment.in_reply_to_id)
      const line = positiveNumber(comment.line)
      const startLine = positiveNumber(comment.start_line)
      const side = enumValue(comment.side, ["LEFT", "RIGHT"] as const)
      if (author) value.author = author
      if (inReplyToId) value.inReplyToId = inReplyToId
      if (line) value.line = line
      if (startLine) value.startLine = startLine
      if (side) value.side = side
      detail = value
    }
  } else if (eventName === "issue_comment") {
    const comment = object(payload.comment)
    const id = positiveNumber(comment?.id)
    if (comment && id && pullRequestNumber) {
      const value: Extract<RoutedEventDetail, { kind: "issue_comment" }> = {
        kind: "issue_comment",
        id,
        url: `https://github.com/${fullName}/pull/${pullRequestNumber}#issuecomment-${id}`,
      }
      const author = principal(object(comment.user)?.login)
      if (author) value.author = author
      detail = value
    }
  } else if (eventName === "check_run") {
    const checkRun = object(payload.check_run)
    const id = positiveNumber(checkRun?.id)
    if (checkRun && id) {
      const value: Extract<RoutedEventDetail, { kind: "check_run" }> = { kind: "check_run", id }
      const url = githubUrl(checkRun.html_url)
      const status = checkStatus(checkRun.status)
      const conclusion = checkConclusion(checkRun.conclusion)
      const headSha = sha(checkRun.head_sha)
      const appSlug = principal(object(checkRun.app)?.slug)
      if (url) value.url = url
      if (status) value.status = status
      if (conclusion !== undefined) value.conclusion = conclusion
      if (headSha) value.headSha = headSha
      if (appSlug) value.appSlug = appSlug
      detail = value
    }
  } else if (eventName === "check_suite") {
    const checkSuite = object(payload.check_suite)
    const id = positiveNumber(checkSuite?.id)
    const [owner, repository] = fullName.split("/")
    if (checkSuite && id && owner && repository) {
      const value: Extract<RoutedEventDetail, { kind: "check_suite" }> = {
        kind: "check_suite",
        id,
        apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-suites/${id}`,
      }
      const status = checkStatus(checkSuite.status)
      const conclusion = checkConclusion(checkSuite.conclusion)
      const headSha = sha(checkSuite.head_sha)
      const appSlug = principal(object(checkSuite.app)?.slug)
      if (status) value.status = status
      if (conclusion !== undefined) value.conclusion = conclusion
      if (headSha) value.headSha = headSha
      if (appSlug) value.appSlug = appSlug
      detail = value
    }
  } else if (eventName === "workflow_run") {
    const workflowRun = object(payload.workflow_run)
    const id = positiveNumber(workflowRun?.id)
    if (workflowRun && id) {
      const value: Extract<RoutedEventDetail, { kind: "workflow_run" }> = { kind: "workflow_run", id }
      const url = githubUrl(workflowRun.html_url)
      const status = checkStatus(workflowRun.status)
      const conclusion = checkConclusion(workflowRun.conclusion)
      const event = triggerName(workflowRun.event)
      const runAttempt = positiveNumber(workflowRun.run_attempt)
      const headSha = sha(workflowRun.head_sha)
      if (url) value.url = url
      if (status) value.status = status
      if (conclusion !== undefined) value.conclusion = conclusion
      if (event) value.triggerEvent = event
      if (runAttempt) value.runAttempt = runAttempt
      if (headSha) value.headSha = headSha
      detail = value
    }
  }

  return detail && JSON.stringify(detail).length <= 4_096 ? detail : undefined
}

export function normalizeGitHubEvent(
  eventName: string,
  deliveryId: string,
  payload: unknown,
): RoutedEvent[] {
  const root = object(payload)
  const repository = object(root?.repository)
  const repositoryId = number(repository?.id)
  const fullName = repositoryName(repository?.full_name)
  if (!root || !repository || repositoryId === null || !fullName
    || !/^[A-Za-z0-9-]{1,128}$/.test(deliveryId)) return []

  const action = triggerName(root.action) ?? triggerName(eventName) ?? "unknown"
  const sender = principal(object(root.sender)?.login) ?? null
  const occurredAt = new Date().toISOString()
  const detail = detailFor(eventName, root, fullName)
  const common = {
    schemaVersion: 1 as const,
    deliveryId,
    githubEvent: eventName,
    action,
    repository: { id: repositoryId, fullName },
    sender,
    occurredAt,
    ...(detail ? { detail } : {}),
  }
  const pullRequestEvents: RoutedEvent[] = pullRequestsFor(eventName, root).flatMap((pullRequest) => {
    const pullRequestNumber = number(pullRequest.number)
    const event = classify(eventName, action, pullRequest)
    if (pullRequestNumber === null || !event) return []
    return [{
      ...common,
      event,
      targetType: "pull_request" as const,
      pullRequest: { number: pullRequestNumber, url: `https://github.com/${fullName}/pull/${pullRequestNumber}` },
    }]
  })
  const branch = branchFor(eventName, root)
  const branchEvent = eventName === "push" ? "commits"
    : eventName === "check_run" || eventName === "check_suite" || eventName === "workflow_run" ? "checks"
      : null
  return branch && branchEvent ? [
    ...pullRequestEvents,
    {
      ...common,
      event: branchEvent,
      targetType: "branch",
      branch: { name: branch, url: branchUrl(fullName, branch) },
    },
  ] : pullRequestEvents
}
