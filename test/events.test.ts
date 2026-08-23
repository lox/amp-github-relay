import { describe, expect, test } from "bun:test"
import { normalizeGitHubEvent } from "../src/events"

const repository = { id: 42, full_name: "lox/project" }
const pullRequest = { number: 17, html_url: "https://github.com/lox/project/pull/17" }

describe("normalizeGitHubEvent", () => {
  test("classifies commits and merges", () => {
    expect(normalizeGitHubEvent("pull_request", "delivery-1", {
      action: "synchronize",
      repository,
      pull_request: pullRequest,
    })[0]?.event).toBe("commits")

    expect(normalizeGitHubEvent("pull_request", "delivery-2", {
      action: "closed",
      repository,
      pull_request: { ...pullRequest, merged: true },
    })[0]?.event).toBe("merged")
  })

  test("routes checks to every associated PR", () => {
    const events = normalizeGitHubEvent("check_run", "delivery-3", {
      action: "completed",
      repository,
      check_run: { pull_requests: [pullRequest, { number: 18 }] },
    })
    expect(events.map((event) => event.pullRequest.number)).toEqual([17, 18])
    expect(events.every((event) => event.event === "checks")).toBe(true)
  })

  test("ignores issue comments that are not on a PR", () => {
    expect(normalizeGitHubEvent("issue_comment", "delivery-4", {
      action: "created",
      repository,
      issue: { number: 17 },
    })).toEqual([])
  })
})
