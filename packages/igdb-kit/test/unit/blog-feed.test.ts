import { describe, expect, test } from "bun:test";
import { newArticles, parseFeed } from "../../scripts/blog-feed";

// Two items as Medium's feed sends them: CDATA titles, a tracking query on each link; the second
// lacks its date.
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>IGDB</title>
<item><title><![CDATA[API v4: image_type replaces artwork_type]]></title><link>https://medium.com/igdb/api-v4-b2?source=rss----1</link><guid isPermaLink="false">https://medium.com/p/b2</guid><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title><![CDATA[Webhooks & popularity]]></title><link>https://medium.com/igdb/webhooks-a1?source=rss----1</link><guid isPermaLink="false">https://medium.com/p/a1</guid></item>
</channel></rss>`;

describe("blog feed", () => {
  test("reads each item's guid, title, link without its query, and day (empty when missing)", () => {
    expect(parseFeed(FEED)).toEqual([
      {
        id: "https://medium.com/p/b2",
        title: "API v4: image_type replaces artwork_type",
        link: "https://medium.com/igdb/api-v4-b2",
        published: "2026-11-24",
      },
      {
        id: "https://medium.com/p/a1",
        title: "Webhooks & popularity",
        link: "https://medium.com/igdb/webhooks-a1",
        published: "",
      },
    ]);
  });

  test("keeps the articles not seen yet, and records them first", () => {
    const { fresh, seen } = newArticles(parseFeed(FEED), ["https://medium.com/p/a1"]);
    expect(fresh.map((a) => a.link)).toEqual(["https://medium.com/igdb/api-v4-b2"]);
    expect(seen).toEqual(["https://medium.com/p/b2", "https://medium.com/p/a1"]);
    expect(newArticles(parseFeed(FEED), seen).fresh).toEqual([]);
  });

  test("reads Medium's spaced layout, with spaces inside CDATA and other tags in each item", () => {
    const spaced = `<rss><channel><title>
<![CDATA[ IGDB - Medium ]]>
</title><item>
<title>
<![CDATA[ Every Cover Tells a Story: Expanded Cover & Logo Data on IGDB ]]>
</title>
<link>https://medium.com/igdb/every-cover-tells-a-story-830a0faa9841?source=rss----6cd72f534b46---4</link>
<guid isPermaLink="false">https://medium.com/p/830a0faa9841</guid>
<category>
<![CDATA[ api ]]>
</category>
<pubDate>Fri, 07 Aug 2026 08:49:07 GMT</pubDate>
<content:encoded>
<![CDATA[ <p>The existing artwork_type field is now going to be deprecated.</p> ]]>
</content:encoded>
</item></channel></rss>`;
    expect(parseFeed(spaced)).toEqual([
      {
        id: "https://medium.com/p/830a0faa9841",
        title: "Every Cover Tells a Story: Expanded Cover & Logo Data on IGDB",
        link: "https://medium.com/igdb/every-cover-tells-a-story-830a0faa9841",
        published: "2026-08-07",
      },
    ]);
  });

  test("finds no article in a page that is not a feed", () => {
    expect(parseFeed("<html><title>Just a moment...</title></html>")).toEqual([]);
  });
});
