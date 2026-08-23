import { createRelay } from "./app"
import { createOidcAuthenticator } from "./auth"

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const port = Number(process.env.PORT ?? "3000")
const values = (name: string) => (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const relay = createRelay({
  databasePath: process.env.DATABASE_PATH ?? "./data/relay.sqlite",
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  allowedWebhookHosts: required("AMP_WEBHOOK_ALLOWED_HOSTS").split(",").map((host) => host.trim().toLowerCase()),
  authenticate: createOidcAuthenticator({
    audience: required("AMP_OIDC_AUDIENCE"),
    allowedWorkspaceIds: values("AMP_ALLOWED_WORKSPACE_IDS"),
    allowedProjectIds: values("AMP_ALLOWED_PROJECT_IDS"),
    allowedUserIds: values("AMP_ALLOWED_USER_IDS"),
  }),
})

Bun.serve({
  port,
  fetch: relay.fetch,
})

console.log(`amp-github-relay listening on port ${port}`)
