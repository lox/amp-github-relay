import { describe, expect, test } from "bun:test"
import { normalizeGitHubEvent } from "../src/events"

const repository = { id: 42, full_name: "lox/project" }
const pullRequest = { number: 17, html_url: "https://github.com/lox/project/pull/17" }
const headSha = "a".repeat(40)
const beforeSha = "b".repeat(40)
const afterSha = "c".repeat(40)

describe("normalizeGitHubEvent", () => {
  test("classifies commits and includes pull request state and commit SHAs", () => {
    const event = normalizeGitHubEvent("pull_request", "delivery-1", {
      action: "synchronize",
      repository,
      pull_request: {
        ...pullRequest,
        state: "open",
        draft: false,
        merged: false,
        head: { sha: headSha },
      },
      before: beforeSha,
      after: afterSha,
    })[0]
    expect(event?.event).toBe("commits")
    expect(event?.detail).toEqual({
      kind: "pull_request",
      state: "open",
      draft: false,
      merged: false,
      headSha,
      beforeSha,
      afterSha,
    })

    expect(normalizeGitHubEvent("pull_request", "delivery-2", {
      action: "closed",
      repository,
      pull_request: { ...pullRequest, merged: true },
    })[0]?.event).toBe("merged")
  })

  test("includes review state, author, URL, and commit", () => {
    const event = normalizeGitHubEvent("pull_request_review", "delivery-review", {
      action: "submitted",
      repository,
      pull_request: pullRequest,
      sender: { login: "webhook-sender" },
      review: {
        id: 91,
        html_url: "https://github.com/lox/project/pull/17#pullrequestreview-91",
        state: "APPROVED",
        user: { login: "review-author" },
        commit_id: headSha,
        submitted_at: "2026-08-23T10:20:30Z",
      },
    })[0]
    expect(event?.detail).toEqual({
      kind: "pull_request_review",
      id: 91,
      url: "https://github.com/lox/project/pull/17#pullrequestreview-91",
      state: "approved",
      author: "review-author",
      commitSha: headSha,
      submittedAt: "2026-08-23T10:20:30.000Z",
    })
  })

  test("includes review comment location and reply metadata", () => {
    const event = normalizeGitHubEvent("pull_request_review_comment", "delivery-review-comment", {
      action: "created",
      repository,
      pull_request: pullRequest,
      comment: {
        id: 92,
        html_url: "https://github.com/lox/project/pull/17#discussion_r92",
        user: { login: "commenter" },
        created_at: "2026-08-23T10:20:30Z",
        updated_at: "2026-08-23T10:21:30Z",
        in_reply_to_id: 90,
        line: 27,
        start_line: 24,
        side: "RIGHT",
        start_side: "RIGHT",
      },
    })[0]
    expect(event?.detail).toEqual({
      kind: "pull_request_review_comment",
      id: 92,
      url: "https://github.com/lox/project/pull/17#discussion_r92",
      author: "commenter",
      createdAt: "2026-08-23T10:20:30.000Z",
      updatedAt: "2026-08-23T10:21:30.000Z",
      inReplyToId: 90,
      line: 27,
      startLine: 24,
      side: "RIGHT",
      startSide: "RIGHT",
    })
  })

  test("includes issue comment identity and URL", () => {
    const event = normalizeGitHubEvent("issue_comment", "delivery-comment", {
      action: "created",
      repository,
      issue: { number: 17, pull_request: { html_url: pullRequest.html_url } },
      comment: {
        id: 93,
        html_url: "https://github.com/lox/project/pull/17#issuecomment-93",
        user: { login: "dependabot[bot]" },
        created_at: "2026-08-23T10:20:30Z",
        updated_at: "2026-08-23T10:21:30Z",
      },
    })[0]
    expect(event?.detail).toEqual({
      kind: "issue_comment",
      id: 93,
      url: "https://github.com/lox/project/pull/17#issuecomment-93",
      author: "dependabot[bot]",
      createdAt: "2026-08-23T10:20:30.000Z",
      updatedAt: "2026-08-23T10:21:30.000Z",
    })
  })

  test("routes a check run descriptor to every associated PR", () => {
    const events = normalizeGitHubEvent("check_run", "delivery-3", {
      action: "completed",
      repository,
      check_run: {
        id: 94,
        html_url: "https://github.com/lox/project/runs/94",
        status: "completed",
        conclusion: null,
        head_sha: headSha,
        app: { slug: "github-actions" },
        started_at: "2026-08-23T10:20:30Z",
        completed_at: "2026-08-23T10:21:30Z",
        pull_requests: [pullRequest, { number: 18 }],
      },
    })
    expect(events.map((event) => event.pullRequest.number)).toEqual([17, 18])
    expect(events.every((event) => event.event === "checks")).toBe(true)
    expect(events[0]?.detail).toEqual({
      kind: "check_run",
      id: 94,
      url: "https://github.com/lox/project/runs/94",
      status: "completed",
      conclusion: null,
      headSha,
      appSlug: "github-actions",
      startedAt: "2026-08-23T10:20:30.000Z",
      completedAt: "2026-08-23T10:21:30.000Z",
    })
    expect(events[1]?.detail).toEqual(events[0]?.detail)
  })

  test("includes check suite state and a synthesized API path", () => {
    const event = normalizeGitHubEvent("check_suite", "delivery-suite", {
      action: "completed",
      repository,
      check_suite: {
        id: 95,
        status: "completed",
        conclusion: "failure",
        head_sha: headSha,
        app: { slug: "github-actions" },
        pull_requests: [pullRequest],
      },
    })[0]
    expect(event?.detail).toEqual({
      kind: "check_suite",
      id: 95,
      apiPath: "/repos/lox/project/check-suites/95",
      status: "completed",
      conclusion: "failure",
      headSha,
      appSlug: "github-actions",
    })
  })

  test("includes workflow run state and attempt metadata", () => {
    const event = normalizeGitHubEvent("workflow_run", "delivery-workflow", {
      action: "completed",
      repository,
      workflow_run: {
        id: 96,
        workflow_id: 97,
        html_url: "https://github.com/lox/project/actions/runs/96",
        status: "completed",
        conclusion: "timed_out",
        event: "pull_request",
        run_number: 12,
        run_attempt: 2,
        head_sha: headSha,
        created_at: "2026-08-23T10:20:30Z",
        run_started_at: "2026-08-23T10:20:40Z",
        updated_at: "2026-08-23T10:21:30Z",
        pull_requests: [pullRequest],
      },
    })[0]
    expect(event?.detail).toEqual({
      kind: "workflow_run",
      id: 96,
      workflowId: 97,
      url: "https://github.com/lox/project/actions/runs/96",
      status: "completed",
      conclusion: "timed_out",
      triggerEvent: "pull_request",
      runNumber: 12,
      runAttempt: 2,
      headSha,
      createdAt: "2026-08-23T10:20:30.000Z",
      runStartedAt: "2026-08-23T10:20:40.000Z",
      updatedAt: "2026-08-23T10:21:30.000Z",
    })
  })

  test("omits malformed detail fields without losing routing", () => {
    const event = normalizeGitHubEvent("check_run", "delivery-malformed", {
      action: "completed",
      repository,
      check_run: {
        id: 98,
        html_url: "https://attacker.example/check/98",
        status: "surprising",
        conclusion: "excellent",
        head_sha: "not-a-sha",
        app: { slug: "line\nbreak" },
        pull_requests: [pullRequest],
      },
    })[0]
    expect(event?.detail).toEqual({ kind: "check_run", id: 98 })

    const missingIdentity = normalizeGitHubEvent("check_run", "delivery-no-id", {
      action: "completed",
      repository,
      check_run: { id: "98", pull_requests: [pullRequest] },
    })[0]
    expect(missingIdentity?.event).toBe("checks")
    expect(missingIdentity?.detail).toBeUndefined()
  })

  test("never forwards PR-controlled prose or patches", () => {
    const sentinel = "UNTRUSTED_SENTINEL"
    const events = [
      ...normalizeGitHubEvent("pull_request", "delivery-pr-sentinel", {
        action: "edited",
        repository,
        pull_request: { ...pullRequest, title: sentinel, body: sentinel },
      }),
      ...normalizeGitHubEvent("pull_request_review", "delivery-review-sentinel", {
        action: "submitted",
        repository,
        pull_request: pullRequest,
        review: {
          id: 101,
          html_url: "https://github.com/lox/project/pull/17#pullrequestreview-101",
          body: sentinel,
        },
      }),
      ...normalizeGitHubEvent("pull_request_review_comment", "delivery-comment-sentinel", {
        action: "created",
        repository,
        pull_request: pullRequest,
        comment: {
          id: 102,
          html_url: "https://github.com/lox/project/pull/17#discussion_r102",
          body: sentinel,
          diff_hunk: sentinel,
          path: sentinel,
        },
      }),
      ...normalizeGitHubEvent("check_run", "delivery-check-sentinel", {
        action: "completed",
        repository,
        check_run: {
          id: 103,
          name: sentinel,
          details_url: `https://example.test/${sentinel}`,
          output: { title: sentinel, summary: sentinel, text: sentinel },
          pull_requests: [pullRequest],
        },
      }),
      ...normalizeGitHubEvent("workflow_run", "delivery-workflow-sentinel", {
        action: "completed",
        repository,
        workflow_run: {
          id: 104,
          name: sentinel,
          display_title: sentinel,
          head_branch: sentinel,
          head_commit: { message: sentinel },
          pull_requests: [pullRequest],
        },
      }),
    ]
    expect(JSON.stringify(events)).not.toContain(sentinel)
  })

  test("ignores issue comments that are not on a PR", () => {
    expect(normalizeGitHubEvent("issue_comment", "delivery-4", {
      action: "created",
      repository,
      issue: { number: 17 },
    })).toEqual([])
  })
})
