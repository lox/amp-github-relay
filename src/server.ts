import { createRelay } from "./app"

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const port = Number(process.env.PORT ?? "3000")
const relay = createRelay({
  databasePath: process.env.DATABASE_PATH ?? "./data/relay.sqlite",
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  apiToken: required("RELAY_API_TOKEN"),
  relaySigningSecret: required("RELAY_SIGNING_SECRET"),
  allowedWebhookHosts: required("AMP_WEBHOOK_ALLOWED_HOSTS").split(",").map((host) => host.trim().toLowerCase()),
})

Bun.serve({
  port,
  fetch: relay.fetch,
})

console.log(`amp-github-relay listening on port ${port}`)
