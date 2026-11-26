import { describe, expect, test } from "bun:test";
import { newArticles, parseFeed } from "../../scripts/blog-feed";

// Two items as Medium's feed sends them: CDATA titles, a tracking query on each link.
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>IGDB</title>
<item><title><![CDATA[API v4: image_type replaces artwork_type]]></title><link>https://medium.com/igdb/api-v4-b2?source=rss----1</link><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title><![CDATA[Webhooks & popularity]]></title><link>https://medium.com/igdb/webhooks-a1?source=rss----1</link><pubDate>Mon, 12 Oct 2026 09:30:00 GMT</pubDate></item>
</channel></rss>`;

describe("blog feed", () => {
  test("reads each item's title, link without its query, and day", () => {
    expect(parseFeed(FEED)).toEqual([
      {
        title: "API v4: image_type replaces artwork_type",
        link: "https://medium.com/igdb/api-v4-b2",
        published: "2026-11-24",
      },
      {
        title: "Webhooks & popularity",
        link: "https://medium.com/igdb/webhooks-a1",
        published: "2026-10-12",
      },
    ]);
  });

  test("keeps the articles not seen yet, and records them first", () => {
    const { fresh, seen } = newArticles(parseFeed(FEED), ["https://medium.com/igdb/webhooks-a1"]);
    expect(fresh.map((a) => a.link)).toEqual(["https://medium.com/igdb/api-v4-b2"]);
    expect(seen).toEqual(["https://medium.com/igdb/api-v4-b2", "https://medium.com/igdb/webhooks-a1"]);
    expect(newArticles(parseFeed(FEED), seen).fresh).toEqual([]);
  });
});
