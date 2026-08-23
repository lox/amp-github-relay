import { createRemoteJWKSet, jwtVerify } from "jose"

const issuer = "https://ampcode.com/api/workload-identity"
const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks.json`))

export interface OrbIdentity {
  threadId: string
  workspaceId: string | null
  projectId: string | null
  userId: string
}

export interface OidcConfig {
  audience: string | string[]
  allowedWorkspaceIds: string[]
  allowedProjectIds: string[]
  allowedUserIds: string[]
}

function claim(payload: Record<string, unknown>, name: string): string | null {
  return typeof payload[name] === "string" ? payload[name] : null
}

export function createOidcAuthenticator(config: OidcConfig) {
  if (
    config.allowedWorkspaceIds.length === 0
    && config.allowedProjectIds.length === 0
    && config.allowedUserIds.length === 0
  ) {
    throw new Error("At least one Amp workspace, project, or user allowlist is required")
  }

  return async function authenticate(request: Request): Promise<OrbIdentity> {
    const authorization = request.headers.get("authorization") ?? ""
    if (!authorization.startsWith("Bearer ")) throw new Error("Missing bearer token")
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    })
    const threadId = claim(payload, "thread_id")
    const workspaceId = claim(payload, "workspace_id")
    const projectId = claim(payload, "project_id")
    const userId = claim(payload, "user_id")
    if (!threadId || !userId || payload.token_use !== "exchanged") {
      throw new Error("Invalid Amp workload identity claims")
    }
    if (config.allowedWorkspaceIds.length > 0 && (!workspaceId || !config.allowedWorkspaceIds.includes(workspaceId))) {
      throw new Error("Amp workspace is not allowed")
    }
    if (config.allowedProjectIds.length > 0 && (!projectId || !config.allowedProjectIds.includes(projectId))) {
      throw new Error("Amp project is not allowed")
    }
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      throw new Error("Amp user is not allowed")
    }
    return { threadId, workspaceId, projectId, userId }
  }
}
