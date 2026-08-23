const encoder = new TextEncoder()

export async function hmacSha256(secret: string, body: Uint8Array | string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = typeof body === "string" ? encoder.encode(body) : body
  const signature = await crypto.subtle.sign("HMAC", key, Uint8Array.from(bytes))
  return `sha256=${Buffer.from(signature).toString("hex")}`
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

export async function verifyHmac(secret: string, body: Uint8Array, signature: string): Promise<boolean> {
  return timingSafeEqual(await hmacSha256(secret, body), signature)
}
