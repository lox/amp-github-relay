import { describe, expect, test } from "bun:test"
import { parseFeed, validateFeedUrl } from "../src/feeds"

describe("parseFeed", () => {
  test("parses Atom entries and fingerprints content updates", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Namespace status</title>
        <entry>
          <id>incident-1</id>
          <title><![CDATA[Queue delays]]></title>
          <link href="/incidents/1" />
          <updated>2026-08-25T10:20:30Z</updated>
          <content><![CDATA[Investigating]]></content>
        </entry>
      </feed>`
    const first = parseFeed(xml, "https://namespace-status.com/feed.atom")
    const updated = parseFeed(xml.replace("Investigating", "Resolved"), "https://namespace-status.com/feed.atom")

    expect(first).toMatchObject({
      title: "Namespace status",
      entries: [{
        id: "incident-1",
        title: "Queue delays",
        url: "https://namespace-status.com/incidents/1",
        updatedAt: "2026-08-25T10:20:30.000Z",
      }],
    })
    expect(first.entries[0]?.fingerprint).not.toBe(updated.entries[0]?.fingerprint)
  })

  test("parses RSS 2.0 entries", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Namespace status</title>
        <item>
          <guid>incident-1</guid>
          <title>Queue delays</title>
          <link>https://namespace-status.com/incidents/1</link>
          <pubDate>Tue, 25 Aug 2026 10:20:30 GMT</pubDate>
          <description>Status update</description>
        </item>
      </channel></rss>`, "https://namespace-status.com/feed.rss")

    expect(feed).toMatchObject({
      title: "Namespace status",
      entries: [{
        id: "incident-1",
        title: "Queue delays",
        url: "https://namespace-status.com/incidents/1",
        publishedAt: "2026-08-25T10:20:30.000Z",
      }],
    })
  })

  test("rejects non-feed XML", () => {
    expect(() => parseFeed("<html><body>not a feed</body></html>", "https://example.com"))
      .toThrow("RSS or Atom feed")
  })

  test("rejects private feed endpoints", async () => {
    await expect(validateFeedUrl("https://127.0.0.1/feed.xml"))
      .rejects.toThrow("public addresses")
    await expect(validateFeedUrl("https://[fe90::1]/feed.xml"))
      .rejects.toThrow("public addresses")
    await expect(validateFeedUrl("http://namespace-status.com/feed.rss"))
      .rejects.toThrow("public HTTPS URL")
  })
})
