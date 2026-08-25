import { createHash } from "node:crypto"
import { BlockList } from "node:net"
import { lookup } from "node:dns/promises"
import { request } from "node:https"
import { XMLParser } from "fast-xml-parser"
import type { FeedEntry, ParsedFeed } from "./types"

const maximumFeedBytes = 1_048_576
const maximumEntries = 100
const blockedAddresses = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8], ["2001:db8::", 32],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6")

type XmlValue = string | number | Record<string, unknown> | XmlValue[] | null | undefined

function values(value: XmlValue): XmlValue[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}

function record(value: XmlValue): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: XmlValue): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null
  const item = record(value)
  if (!item) return null
  return text(item["#cdata"] as XmlValue) ?? text(item["#text"] as XmlValue)
}

function bounded(value: string | null, maximum: number): string | null {
  if (!value) return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return cleaned ? cleaned.slice(0, maximum) : null
}

function date(value: string | null): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function publicUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, baseUrl)
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href.slice(0, 2_048)
      : null
  } catch {
    return null
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function entry(
  item: Record<string, unknown>,
  baseUrl: string,
  format: "atom" | "rss",
): FeedEntry {
  const atomLinks = values(item.link as XmlValue).map(record).filter((link) => link !== null)
  const link = format === "atom"
    ? text(atomLinks.find((candidate) => candidate["@rel"] === "alternate")?.["@href"] as XmlValue)
      ?? text(atomLinks[0]?.["@href"] as XmlValue)
      ?? text(item.link as XmlValue)
    : text(item.link as XmlValue)
  const title = bounded(text(item.title as XmlValue), 500)
  const publishedAt = date(text((format === "atom" ? item.published : item.pubDate) as XmlValue))
  const updatedAt = date(text((format === "atom" ? item.updated : item["dc:date"]) as XmlValue))
  const url = publicUrl(link, baseUrl)
  const declaredId = bounded(text((format === "atom" ? item.id : item.guid) as XmlValue), 2_048)
  const content = text((format === "atom" ? item.content ?? item.summary : item["content:encoded"] ?? item.description) as XmlValue)
  const identity = declaredId ?? url ?? hash(JSON.stringify([title, publishedAt, updatedAt, content]))
  return {
    id: identity,
    fingerprint: hash(JSON.stringify([identity, title, url, publishedAt, updatedAt, content])),
    title,
    url,
    publishedAt,
    updatedAt,
  }
}

export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    textNodeName: "#text",
    cdataPropName: "#cdata",
    processEntities: false,
  })
  const document = parser.parse(xml) as Record<string, unknown>
  const atom = record(document.feed as XmlValue)
  const rss = record(document.rss as XmlValue)
  const channel = record(rss?.channel as XmlValue)
  const source = atom ?? channel
  const format = atom ? "atom" : channel ? "rss" : null
  if (!source || !format) throw new Error("URL did not return an RSS or Atom feed")
  const rawEntries = values((format === "atom" ? source.entry : source.item) as XmlValue)
    .map(record)
    .filter((item) => item !== null)
    .slice(0, maximumEntries)
  return {
    title: bounded(text(source.title as XmlValue), 500),
    entries: rawEntries.map((item) => entry(item, feedUrl, format)),
  }
}

function privateIp(address: string): boolean {
  if (address.toLowerCase().startsWith("::ffff:")) return true
  const family = address.includes(":") ? "ipv6" : "ipv4"
  return blockedAddresses.check(address, family)
}

interface FeedTarget {
  url: string
  address: string
  family: 4 | 6
}

async function feedTarget(value: string): Promise<FeedTarget> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Feed URL must be a valid HTTPS URL")
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Feed URL must be a public HTTPS URL")
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => privateIp(address))) {
    throw new Error("Feed URL must resolve only to public addresses")
  }
  url.hash = ""
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0]!
  return { url: url.href, address: selected.address, family: selected.family === 6 ? 6 : 4 }
}

export async function validateFeedUrl(value: string): Promise<string> {
  return (await feedTarget(value)).url
}

interface FeedResponse {
  status: number
  location: string | null
  etag: string | null
  lastModified: string | null
  body: string
}

function requestFeed(target: FeedTarget, headers: Record<string, string>): Promise<FeedResponse> {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(target.url)
    const feedRequest = request(requestUrl, {
      headers: { host: requestUrl.host, ...headers },
      servername: requestUrl.hostname,
      signal: AbortSignal.timeout(10_000),
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: target.address, family: target.family }])
        else callback(null, target.address, target.family)
      },
    }, (response) => {
      const status = response.statusCode ?? 0
      const metadata = {
        status,
        location: response.headers.location ?? null,
        etag: response.headers.etag ?? null,
        lastModified: response.headers["last-modified"] ?? null,
      }
      if (status === 304 || status < 200 || status >= 300) {
        response.resume()
        resolve({ ...metadata, body: "" })
        return
      }
      const chunks: Uint8Array[] = []
      let length = 0
      response.on("data", (chunk: Uint8Array) => {
        length += chunk.length
        if (length > maximumFeedBytes) {
          response.destroy(new Error("Feed exceeds the 1 MiB limit"))
          return
        }
        chunks.push(chunk)
      })
      response.on("end", () => resolve({ ...metadata, body: Buffer.concat(chunks).toString("utf8") }))
      response.on("error", reject)
    })
    feedRequest.on("error", reject)
    feedRequest.end()
  })
}

export interface FetchedFeed {
  feed: ParsedFeed | null
  etag: string | null
  lastModified: string | null
}

export async function fetchFeed(
  value: string,
  conditional: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchedFeed> {
  let target = await feedTarget(value)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await requestFeed(target, {
      accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9",
      ...(conditional.etag ? { "if-none-match": conditional.etag } : {}),
      ...(conditional.lastModified ? { "if-modified-since": conditional.lastModified } : {}),
    })
    if (response.status === 304) {
      return { feed: null, etag: conditional.etag ?? null, lastModified: conditional.lastModified ?? null }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.location
      if (!location || redirects === 3) throw new Error("Feed redirected too many times")
      target = await feedTarget(new URL(location, target.url).href)
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Feed returned HTTP ${response.status}`)
    return {
      feed: parseFeed(response.body, target.url),
      etag: response.etag,
      lastModified: response.lastModified,
    }
  }
  throw new Error("Feed redirected too many times")
}
