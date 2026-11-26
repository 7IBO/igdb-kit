import { describe, expect, test } from "bun:test";
import { WebsiteType } from "../../src";
import { wikipediaLink, wikipediaLinkFields } from "../../src/game";

const site = (url: string, type: number = WebsiteType.Wikipedia) => ({ id: 1, type, url });
const game = {
  websites: [
    site("https://www.thewitcher.com", WebsiteType.OfficialWebsite),
    site("https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt"),
    site(" http://ja.m.wikipedia.org/wiki/%E3%82%A6%E3%82%A3%E3%83%83%E3%83%81%E3%83%A3%E3%83%BC3 "),
    site("https://no.wikipedia.org/wiki/The_Witcher_3"),
    site("https://tl.wikipedia.org/wiki/The_Witcher_3"),
    site("https://zh-yue.wikipedia.org/wiki/The_Witcher_3"),
    // IGDB files some articles under another type.
    site("https://fr.wikipedia.org/wiki/The_Witcher_3#Accueil", WebsiteType.CommunityWiki),
  ],
};

describe("wikipediaLink()", () => {
  test("takes the article of the locale's language, at its desktop https address", () => {
    expect(wikipediaLink(game, { locale: "ja-JP" })).toEqual({
      url: "https://ja.wikipedia.org/wiki/%E3%82%A6%E3%82%A3%E3%83%83%E3%83%81%E3%83%A3%E3%83%BC3",
      language: "ja",
      match: "locale",
    });
    expect(wikipediaLink(game, { locale: "fr-CA" })).toEqual({
      url: "https://fr.wikipedia.org/wiki/The_Witcher_3#Accueil",
      language: "fr",
      match: "locale",
    });
  });

  test("knows the locales whose Wikipedia is at another code", () => {
    expect(wikipediaLink(game, { locale: "nb-NO" })?.language).toBe("no");
    expect(wikipediaLink(game, { locale: "fil-PH" })?.language).toBe("tl");
    expect(wikipediaLink(game, { locale: "yue-HK" })?.language).toBe("zh-yue");
  });

  test("falls back on the English article, unless told not to", () => {
    expect(wikipediaLink(game, { locale: "de" })).toEqual({
      url: "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt",
      language: "en",
      match: "english",
    });
    expect(wikipediaLink(game, { locale: "de", english: false })).toBeNull();
    expect(wikipediaLink(game, { locale: "en-GB" })?.match).toBe("locale");
  });

  test("is null without an article, and reads only wikipedia.org pages of a language", () => {
    const only = (url: string) => wikipediaLink({ websites: [site(url)] }, { locale: "en" });
    expect(wikipediaLink({ websites: [game.websites[2] as never] }, { locale: "de" })).toBeNull();
    expect(only("https://wikipedia.org/wiki/X")).toBeNull();
    expect(only("https://www.wikipedia.org/")).toBeNull();
    expect(only("https://en.wikipedia.org.evil.example/wiki/X")).toBeNull();
    expect(only("ftp://en.wikipedia.org/wiki/X")).toBeNull();
    expect(only("not a url")).toBeNull();
    expect(wikipediaLink({ websites: [] }, { locale: "en" })).toBeNull();
  });

  test("keeps the first article of a language, and lists the field it reads", () => {
    const twice = {
      websites: [site("https://en.wikipedia.org/wiki/A"), site("https://EN.wikipedia.org/wiki/B")],
    };
    expect(wikipediaLink(twice, { locale: "en" })?.url).toBe("https://en.wikipedia.org/wiki/A");
    expect(wikipediaLinkFields()).toEqual(["websites.url"]);
  });
});
