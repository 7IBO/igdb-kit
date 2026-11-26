// Follows IGDB's blog (its Medium RSS feed), where IGDB announces API changes, so that nobody has
// to watch it: the weekly schema update runs this and lists each new article in its pull request.
//
//   bun run blog-feed >> audit.md
//
// The articles already seen live in codegen/blog-feed.json. A new one is added there, so the schema
// update opens its pull request even when the proto did not change. Prints Markdown for the pull
// request's body, and exits with 1 when the feed cannot be read or holds no article: the run turns
// red rather than following nothing in silence.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FEED = "https://medium.com/feed/igdb";
const SEEN = join(import.meta.dir, "../codegen/blog-feed.json");

export interface Article {
  /** The item's guid (`https://medium.com/p/<id>`): its link holds the slug, which follows the title. */
  id: string;
  title: string;
  link: string;
  published: string;
}

const text = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m?.[1]?.trim() ?? "";
};

/** The articles of an RSS feed, newest first as Medium sends them, without the tracking query. */
export function parseFeed(xml: string): Article[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item = ""]) => {
    const link = text(item, "link").replace(/\?.*$/, "");
    const date = new Date(text(item, "pubDate"));
    return {
      id: text(item.replace(/<guid [^>]*>/, "<guid>"), "guid") || link,
      title: text(item, "title"),
      link,
      published: Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10),
    };
  });
}

/** The articles of the feed that are not in `seen`, and the list to store. */
export function newArticles(feed: Article[], seen: string[]): { fresh: Article[]; seen: string[] } {
  const known = new Set(seen);
  const fresh = feed.filter((a) => !known.has(a.id));
  return { fresh, seen: [...fresh.map((a) => a.id), ...seen] };
}

if (import.meta.main) {
  const res = await fetch(FEED, {
    headers: { "user-agent": "igdb-kit schema update", accept: "application/rss+xml" },
  });
  if (!res.ok) {
    console.log(`\n**Could not read IGDB's blog feed (${FEED}): HTTP ${res.status}.**`);
    process.exit(1);
  }
  const feed = parseFeed(await res.text());
  // A 200 with no item is a challenge page or a broken feed, not a quiet week.
  if (!feed.length) {
    console.log(`\n**IGDB's blog feed (${FEED}) answered with no article.**`);
    process.exit(1);
  }
  const first = !existsSync(SEEN);
  const stored: string[] = first ? [] : JSON.parse(readFileSync(SEEN, "utf8"));
  const { fresh, seen } = newArticles(feed, stored);
  if (first || fresh.length) writeFileSync(SEEN, `${JSON.stringify(seen, null, 2)}\n`);
  if (first) console.log(`\n## IGDB's blog\n\nNow following ${FEED}: ${feed.length} articles recorded.`);
  else if (fresh.length) {
    console.log(`\n## New on IGDB's blog\n\nRead each one for a change to the API before merging.\n`);
    for (const a of fresh) console.log(`- ${a.published || "undated"}: [${a.title}](${a.link})`);
  }
}
