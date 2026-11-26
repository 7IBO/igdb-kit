import { describe, expect, test } from "bun:test";
import { WebsiteType } from "../../src";
import { wikipediaLink } from "../../src/game";

const site = (url: string, type: number = WebsiteType.Wikipedia) => ({ id: 1, type, url });
const game = {
  websites: [
    site("https://www.thewitcher.com", WebsiteType.OfficialWebsite),
    site("https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt"),
    site("https://ja.m.wikipedia.org/wiki/%E3%82%A6%E3%82%A3%E3%83%83%E3%83%81%E3%83%A3%E3%83%BC3"),
    site("https://no.wikipedia.org/wiki/The_Witcher_3"),
    site("https://fr.wikipedia.org/wiki/The_Witcher_3", WebsiteType.CommunityWiki),
  ],
};

describe("wikipediaLink()", () => {
  test("takes the article of the locale's language, else the English one", () => {
    expect(wikipediaLink(game, "ja-JP")).toEqual({ url: game.websites[2]?.url as string, language: "ja" });
    expect(wikipediaLink(game, "fr-CA")).toEqual({ url: game.websites[4]?.url as string, language: "fr" });
    expect(wikipediaLink(game, "nb-NO")?.language).toBe("no");
    expect(wikipediaLink(game, "de")).toEqual({ url: game.websites[1]?.url as string, language: "en" });
  });

  test("is null without an article in either language", () => {
    expect(wikipediaLink({ websites: [game.websites[2] as never] }, "de")).toBeNull();
    expect(
      wikipediaLink({ websites: [site("https://wikipedia.org/wiki/X"), site("not a url")] }, "en"),
    ).toBeNull();
    expect(
      wikipediaLink({ websites: [site("https://en.wikipedia.org.evil.example/wiki/X")] }, "en"),
    ).toBeNull();
    expect(wikipediaLink({ websites: [] }, "en")).toBeNull();
  });

  test("keeps the first article of a language", () => {
    const twice = {
      websites: [site("https://en.wikipedia.org/wiki/A"), site("https://EN.wikipedia.org/wiki/B")],
    };
    expect(wikipediaLink(twice, "en")?.url).toBe("https://en.wikipedia.org/wiki/A");
  });
});
