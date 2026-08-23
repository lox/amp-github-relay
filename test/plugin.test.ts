import { describe, expect, test } from "bun:test"
import { pullRequestFromShellResult } from "../plugin/github-relay"

const success = (output: unknown) => ({
  status: "done" as const,
  output,
})

describe("pullRequestFromShellResult", () => {
  test("returns the single PR URL from a successful direct create", () => {
    expect(pullRequestFromShellResult("gh pr create --fill", success({
      exitCode: 0,
      output: "https://github.com/lox/project/pull/17\n",
    }))).toEqual({ repository: "lox/project", number: 17 })
  })

  test("ignores async, failed, and unsupported shell results", () => {
    expect(pullRequestFromShellResult(null, success({
      exitCode: 0,
      output: "https://github.com/lox/project/pull/17\n",
    }))).toBeNull()
    expect(pullRequestFromShellResult("gh pr create --fill", success({
      exitCode: 1,
      output: "https://github.com/lox/project/pull/17\n",
    }))).toBeNull()
    expect(pullRequestFromShellResult("cd app && gh pr create --fill", success({
      exitCode: 0,
      output: "https://github.com/lox/project/pull/17\n",
    }))).toBeNull()
    expect(pullRequestFromShellResult("gh pr create --fill", success("unexpected shape"))).toBeNull()
  })

  test("requires exactly one unique PR", () => {
    expect(pullRequestFromShellResult("gh pr create --fill", success({
      exitCode: 0,
      output: [
        "https://github.com/lox/project/pull/17",
        "https://github.com/lox/other/pull/18",
      ].join("\n"),
    }))).toBeNull()

    expect(pullRequestFromShellResult("gh pr create --fill", success({
      exitCode: 0,
      output: "Created pull request successfully",
    }))).toBeNull()
  })
})
