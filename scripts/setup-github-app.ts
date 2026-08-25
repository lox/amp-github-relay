import { chmod, readFile, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"

const githubEvents = [
  "push",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "check_run",
  "check_suite",
  "workflow_run",
]

export function githubAppManifest(bridgeUrl: string, redirectUrl: string) {
  return {
    name: "amp-subscribe",
    url: bridgeUrl,
    description: "Routes GitHub events to subscribed Amp threads",
    redirect_url: redirectUrl,
    public: false,
    hook_attributes: {
      url: new URL("/github/webhook", bridgeUrl).href,
      active: true,
    },
    default_permissions: {
      metadata: "read",
      contents: "read",
      pull_requests: "read",
      issues: "read",
      checks: "read",
      actions: "read",
    },
    default_events: githubEvents,
  }
}

export function setEnvValue(contents: string, name: string, value: string): string {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, "m")
  if (pattern.test(contents)) return contents.replace(pattern, line)
  return `${contents}${contents.endsWith("\n") || contents.length === 0 ? "" : "\n"}${line}\n`
}

function normalizeBridgeUrl(input: string): string {
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Bridge URL must be a public HTTPS URL without credentials, a query, or a fragment")
  }
  url.pathname = url.pathname.replace(/\/$/, "") || "/"
  return url.href.replace(/\/$/, "")
}

function registrationUrl(organization: string, state: string): string {
  if (!organization) return `https://github.com/settings/apps/new?state=${state}`
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(organization)) {
    throw new Error("Invalid GitHub organization name")
  }
  return `https://github.com/organizations/${organization}/settings/apps/new?state=${state}`
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function launchPage(action: string, manifest: object): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Set up amp-subscribe</title></head>
  <body>
    <p>Redirecting to GitHub to create the app…</p>
    <form id="manifest" action="${action}" method="post">
      <textarea hidden name="manifest">${escapeHtml(JSON.stringify(manifest))}</textarea>
      <button type="submit">Continue to GitHub</button>
    </form>
    <script>document.getElementById("manifest").submit()</script>
  </body>
</html>`
}

function resultPage(title: string, message: string, installUrl?: string): Response {
  const link = installUrl
    ? `<p><a href="${installUrl}">Install the app on repositories</a>, then return to your terminal.</p>`
    : ""
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${escapeHtml(message)}</p>${link}</body></html>`, {
    status: installUrl ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url]
  try {
    Bun.spawn({ cmd: command, stdout: "ignore", stderr: "ignore" }).unref()
  } catch {
    // The URL printed to the terminal is the fallback on headless systems.
  }
}

interface ManifestConversion {
  slug?: string
  webhook_secret?: string | null
  message?: string
}

async function main(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const bridgeInput = await terminal.question("Public bridge URL (for example, https://subscribe.example.com): ")
  const organization = await terminal.question("GitHub organization (leave blank for your personal account): ")
  terminal.close()

  const bridgeUrl = normalizeBridgeUrl(bridgeInput.trim())
  const state = crypto.randomUUID()
  const githubRegistrationUrl = registrationUrl(organization.trim(), state)
  let finish!: (result: { slug: string; installUrl: string }) => void
  let fail!: (error: Error) => void
  const completed = new Promise<{ slug: string; installUrl: string }>((resolve, reject) => {
    finish = resolve
    fail = reject
  })

  let server: Bun.Server<undefined>
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname === "/") {
        const redirectUrl: string = `http://127.0.0.1:${server.port}/callback`
        return new Response(launchPage(
          githubRegistrationUrl,
          githubAppManifest(bridgeUrl, redirectUrl),
        ), { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      if (url.pathname !== "/callback") return new Response("Not found", { status: 404 })
      if (url.searchParams.get("state") !== state) {
        const error = new Error("GitHub returned an invalid state value")
        setTimeout(() => fail(error), 100)
        return resultPage("Setup failed", error.message)
      }
      const code = url.searchParams.get("code")
      if (!code) {
        const error = new Error("GitHub did not return a manifest code")
        setTimeout(() => fail(error), 100)
        return resultPage("Setup failed", error.message)
      }

      try {
        const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2026-03-10",
          },
          signal: AbortSignal.timeout(30_000),
        })
        const conversion = await response.json() as ManifestConversion
        if (!response.ok || !conversion.slug || !conversion.webhook_secret) {
          throw new Error(conversion.message ?? `GitHub returned HTTP ${response.status}`)
        }

        const env = await readFile(".env", "utf8").catch(() => "")
        await writeFile(".env", setEnvValue(env, "GITHUB_WEBHOOK_SECRET", conversion.webhook_secret))
        await chmod(".env", 0o600)
        const installUrl = `https://github.com/apps/${conversion.slug}/installations/new`
        setTimeout(() => finish({ slug: conversion.slug!, installUrl }), 100)
        return resultPage("GitHub App created", "The webhook secret was saved to .env.", installUrl)
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setTimeout(() => fail(error), 100)
        return resultPage("Setup failed", error.message)
      }
    },
  })

  const setupUrl = `http://127.0.0.1:${server.port}/`
  console.log(`\nOpen this URL to continue:\n${setupUrl}\n`)
  openBrowser(setupUrl)

  try {
    const result = await completed
    console.log(`Created GitHub App ${result.slug}.`)
    console.log("Saved its generated webhook secret to .env as GITHUB_WEBHOOK_SECRET.")
    console.log(`Install it on the repositories to watch:\n${result.installUrl}`)
  } finally {
    server.stop()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
