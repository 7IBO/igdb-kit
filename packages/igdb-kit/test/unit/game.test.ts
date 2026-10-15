import { describe, expect, test } from "bun:test";
import {
  AgeRatingOrganization,
  ExternalGameSource,
  GameReleaseFormat,
  Language,
  LanguageSupportType,
  Platform,
  QueryError,
  Region,
  ReleaseDateRegion,
  ReleaseDateStatus,
} from "../../src";
import {
  ageRating,
  ageRatings,
  alternativeTitles,
  companies,
  countryName,
  eventTime,
  externalIds,
  formatPlaytime,
  formatReleaseDate,
  languageName,
  languages,
  localization,
  localizedCover,
  localizedName,
  localizeStoreUrl,
  multiplayer,
  parentGame,
  parseAlternativeName,
  parseStoreUrl,
  regionalReleases,
  releaseDate,
  releaseRegionName,
  releasesByPlatform,
  resolveLocale,
  storeLinks,
  storeOf,
  supportsLanguage,
  timeToBeat,
} from "../../src/game";
import * as fixtures from "./fixtures/games";
import { gta5 } from "./fixtures/related";

const { externalRows, releaseRows, timeToBeatRows, untrustedWebsites } = fixtures;

// Released on PC in 2015; the Wii U version, announced for 2014, was cancelled.
const cancelledPort = {
  release_dates: [
    {
      id: 1,
      date: 1431993600,
      human: "May 19, 2015",
      platform: Platform.PCMicrosoftWindows,
      date_format: 0,
      release_region: ReleaseDateRegion.Worldwide,
      status: ReleaseDateStatus.FullRelease,
    },
    {
      id: 2,
      date: 1419984000,
      human: "2014",
      platform: Platform.WiiU,
      date_format: 2,
      release_region: ReleaseDateRegion.Worldwide,
      status: ReleaseDateStatus.Cancelled,
    },
  ],
};

// Released on Switch in Japan; the European release, planned for 2021, was cancelled.
const cancelledInEurope = {
  release_dates: [
    {
      id: 3,
      date: 1614816000,
      human: "Mar 04, 2021",
      platform: Platform.NintendoSwitch,
      date_format: 0,
      release_region: ReleaseDateRegion.Japan,
      status: ReleaseDateStatus.FullRelease,
    },
    {
      id: 4,
      date: 1640908800,
      human: "2021",
      platform: Platform.NintendoSwitch,
      date_format: 2,
      release_region: ReleaseDateRegion.Europe,
      status: ReleaseDateStatus.Cancelled,
    },
  ],
};

describe("releaseDate()", () => {
  test("the first full release, like IGDB's first_release_date", () => {
    const release = releaseDate(fixtures.witcher3);
    expect(release).toMatchObject({
      precision: "day",
      start: new Date("2015-05-19T00:00:00Z"),
      end: new Date("2015-05-20T00:00:00Z"),
      year: 2015,
      quarter: null,
      month: 5,
      day: 19,
      human: "May 19, 2015",
      status: ReleaseDateStatus.FullRelease,
      region: ReleaseDateRegion.Worldwide,
      match: "any_region",
    });
    expect(release?.start?.getTime()).toBe((fixtures.witcher3.first_release_date ?? 0) * 1000);
  });

  test("full release over an earlier early access", () => {
    // Hades was in early access from December 2018; IGDB's first_release_date is the 1.0.
    expect(releaseDate(fixtures.hades)?.human).toBe("Sep 17, 2020");
    expect(fixtures.hades.first_release_date).toBe(1600300800);
    const early = releaseDate(fixtures.hades, { statuses: [ReleaseDateStatus.EarlyAccess] });
    expect(early).toMatchObject({
      human: "Dec 07, 2018",
      status: ReleaseDateStatus.EarlyAccess,
      platform: Platform.PCMicrosoftWindows,
    });
    expect(releaseDate(fixtures.hades, { statuses: ReleaseDateStatus.EarlyAccess })).toEqual(early);
  });

  test("full release over advanced access and over compatibility releases", () => {
    expect(releaseDate(fixtures.advancedAccess)?.status).toBe(ReleaseDateStatus.FullRelease);
    expect(releaseDate(fixtures.advancedAccess)?.start?.getTime()).toBe(
      (fixtures.advancedAccess.first_release_date ?? 0) * 1000,
    );
    expect(
      releaseDate(fixtures.advancedAccess, { statuses: [ReleaseDateStatus.AdvancedAccess] })?.status,
    ).toBe(ReleaseDateStatus.AdvancedAccess);
    const release = releaseDate(fixtures.compatibilityRelease);
    expect(release).toMatchObject({ status: ReleaseDateStatus.FullRelease, year: 1998 });
  });

  test("early access when the game has nothing else", () => {
    expect(releaseDate(fixtures.starCitizen)).toMatchObject({
      status: ReleaseDateStatus.EarlyAccess,
      human: "Aug 30, 2013",
    });
  });

  test("a missing status is unknown (null), not excluded", () => {
    expect(releaseDate(fixtures.gta5)).toMatchObject({ status: null, year: 2013 });
    expect(releaseDate(fixtures.gta5, { statuses: [null] })?.year).toBe(2013);
    expect(releaseDate(fixtures.gta5, { statuses: [ReleaseDateStatus.FullRelease] })).toBeNull();
  });

  test("one platform", () => {
    expect(releaseDate(fixtures.witcher3, { platform: Platform.NintendoSwitch })?.human).toBe("Jan 28, 2021");
    expect(releaseDate(fixtures.witcher3, { platform: Platform.Wii })).toBeNull();
  });

  test("the requested region over worldwide, worldwide over other regions", () => {
    const switchIn = (region: number) =>
      releaseDate(fixtures.hades, { platform: Platform.NintendoSwitch, region });
    expect(switchIn(ReleaseDateRegion.Europe)).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn(ReleaseDateRegion.Japan)).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
    expect(switchIn(ReleaseDateRegion.Australia)).toMatchObject({
      human: "Sep 17, 2020",
      match: "worldwide",
    });
  });

  test("a locale picks the region of its country", () => {
    const switchIn = (locale: string) =>
      releaseDate(fixtures.hades, { platform: Platform.NintendoSwitch, locale });
    expect(switchIn("fr-FR")).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn("de_DE")).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn("ja-JP")).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
    expect(switchIn("en-AU")).toMatchObject({ human: "Sep 17, 2020", match: "worldwide" });
    // A locale without a country takes its likely one: "fr" is France.
    expect(switchIn("fr")).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn("ja")).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
    // A country IGDB has no region for: no region requested.
    expect(switchIn("es-MX")).toMatchObject({ human: "Sep 17, 2020", match: "any_region" });
    // An explicit region wins over the locale.
    expect(
      releaseDate(fixtures.hades, {
        platform: Platform.NintendoSwitch,
        locale: "fr-FR",
        region: ReleaseDateRegion.Japan,
      }),
    ).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
  });

  test("another region as a last resort, unless fallback is false", () => {
    // Mother 3 was only released in Japan.
    const release = releaseDate(fixtures.mother3, { region: ReleaseDateRegion.Europe });
    expect(release).toMatchObject({ match: "other_region", region: ReleaseDateRegion.Japan, year: 2006 });
    expect(releaseDate(fixtures.mother3, { region: ReleaseDateRegion.Europe, fallback: false })).toBeNull();
  });

  test("TBD and cancelled", () => {
    // Scalebound was cancelled before it had a date: no release, unless statuses asks for it.
    expect(releaseDate(fixtures.scalebound)).toBeNull();
    const release = releaseDate(fixtures.scalebound, { statuses: "all" });
    expect(release).toMatchObject({
      precision: "tbd",
      status: ReleaseDateStatus.Cancelled,
      human: "TBD",
      start: null,
      end: null,
      year: null,
    });
    expect(releaseDate(fixtures.scalebound, { statuses: ReleaseDateStatus.Cancelled })).toEqual(release);
  });

  test("offline and cancelled dates are left out, as in releases()", () => {
    expect(releaseDate(cancelledPort)).toMatchObject({ platform: Platform.PCMicrosoftWindows, year: 2015 });
    expect(releaseDate(cancelledPort, { platform: Platform.WiiU })).toBeNull();
    // With every status, a cancelled date still ranks last.
    expect(releaseDate(cancelledPort, { statuses: "all" })?.platform).toBe(Platform.PCMicrosoftWindows);
    expect(releaseDate(cancelledPort, { platform: Platform.WiiU, statuses: "all" })).toMatchObject({
      status: ReleaseDateStatus.Cancelled,
      year: 2014,
    });
    // A game taken offline keeps the date it came out.
    const shutDown = {
      release_dates: [
        { id: 1, date: 1348531200, human: "Sep 25, 2012", platform: 6, date_format: 0, release_region: 8 },
        {
          id: 2,
          date: 1601510400,
          human: "Oct 01, 2020",
          platform: 6,
          date_format: 0,
          release_region: 8,
          status: ReleaseDateStatus.Offline,
        },
      ],
    };
    expect(releaseDate(shutDown)).toMatchObject({ human: "Sep 25, 2012", status: null });
    expect(releaseDate({ release_dates: shutDown.release_dates.slice(1) })).toBeNull();
  });

  test("a cancelled date of the requested region or worldwide does not hide another region's release", () => {
    expect(releaseDate(cancelledInEurope, { locale: "fr-FR" })).toMatchObject({
      region: ReleaseDateRegion.Japan,
      match: "other_region",
    });
    expect(releaseDate(cancelledInEurope, { locale: "fr-FR", fallback: false })).toBeNull();
    expect(releasesByPlatform(cancelledInEurope, { locale: "fr-FR" }).map((r) => r.match)).toEqual([
      "other_region",
    ]);
    // The same with the European date offline, or with the cancelled date worldwide.
    const changed = (fields: object) =>
      cancelledInEurope.release_dates.map((row) =>
        row.status === ReleaseDateStatus.Cancelled ? { ...row, ...fields } : row,
      );
    for (const release_dates of [
      changed({ status: ReleaseDateStatus.Offline }),
      changed({ release_region: ReleaseDateRegion.Worldwide }),
    ]) {
      expect(releaseDate({ release_dates }, { locale: "fr-FR" })).toMatchObject({
        region: ReleaseDateRegion.Japan,
        match: "other_region",
      });
      expect(releaseDate({ release_dates }, { locale: "fr-FR", fallback: false })).toBeNull();
    }
    expect(releaseDate(cancelledInEurope, { locale: "fr-FR", statuses: "all" })).toMatchObject({
      region: ReleaseDateRegion.Europe,
      status: ReleaseDateStatus.Cancelled,
      match: "exact",
    });
  });

  test("month, quarter and year precision", () => {
    const of = (row: (typeof releaseRows)[keyof typeof releaseRows]) => releaseDate({ release_dates: [row] });
    expect(of(releaseRows.month)).toMatchObject({
      precision: "month",
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
      year: 2026,
      month: 10,
      day: null,
    });
    expect(of(releaseRows.q4)).toMatchObject({
      precision: "quarter",
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2027-01-01T00:00:00Z"),
      year: 2026,
      quarter: 4,
      month: null,
    });
    expect(of(releaseRows.q1)).toMatchObject({ precision: "quarter", year: 2027, quarter: 1 });
    expect(of(releaseRows.year)).toMatchObject({
      precision: "year",
      start: new Date("2027-01-01T00:00:00Z"),
      end: new Date("2028-01-01T00:00:00Z"),
      year: 2027,
      month: null,
    });
    expect(of(releaseRows.year)?.row.date).toBe(Date.UTC(2027, 11, 31) / 1000);
    expect(of(releaseRows.oldYear)).toMatchObject({ precision: "year", year: 1993 });
    expect(of(releaseRows.before1970)).toMatchObject({ precision: "year", year: 1947 });
    expect(releaseDate(fixtures.mayaTheBee)).toMatchObject({ precision: "year", human: "1999" });
  });

  test("compares periods by their end: Q1 2027 comes before 2027", () => {
    const game = { release_dates: [releaseRows.year, releaseRows.q1, releaseRows.q4] };
    expect(releaseDate(game)?.human).toBe("Q4 2026");
    expect(releaseDate({ release_dates: [releaseRows.year, releaseRows.q1] })?.human).toBe("Q1 2027");
  });

  test("a precise date wins over the month or year that contains it", () => {
    // Space Quest IV: IGDB's first_release_date is the "1991" rows' timestamp, January 1.
    const spaceQuest4: fixtures.FullGame = {
      id: 31,
      first_release_date: 662688000,
      release_dates: [
        { id: 708, date: 662688000, human: "1991", platform: 14, date_format: 2, release_region: 8 },
        { id: 706, date: 662688000, human: "1991", platform: 13, date_format: 2, release_region: 8 },
        {
          id: 458866,
          date: 668044800,
          human: "Mar 04, 1991",
          platform: 6,
          date_format: 0,
          release_region: 8,
        },
      ],
    };
    expect(releaseDate(spaceQuest4)?.human).toBe("Mar 04, 1991");
  });

  test("no release dates", () => {
    expect(releaseDate({ release_dates: [] })).toBeNull();
    expect(releaseDate({ id: 1 } as { id: number; release_dates?: never[] })).toBeNull();
  });

  test("expanded relations work like ids", () => {
    const row = {
      ...releaseRows.q4,
      platform: { id: 6, name: "PC" },
      status: { id: 6, name: "Full Release" },
    };
    expect(releaseDate({ release_dates: [row] })).toMatchObject({ platform: 6, status: 6, row });
  });

  test("releasesByPlatform() picks one per platform, earliest first", () => {
    const releases = releasesByPlatform(fixtures.witcher3);
    expect(releases.map((r) => [r.platform, r.human])).toEqual([
      [48, "May 19, 2015"],
      [49, "May 19, 2015"],
      [6, "May 19, 2015"],
      [130, "Jan 28, 2021"],
      [167, "Dec 14, 2022"],
      [169, "Dec 14, 2022"],
      [508, "Sep 29, 2026"],
    ]);
    expect(releasesByPlatform(fixtures.scalebound)).toEqual([]);
    expect(releasesByPlatform(fixtures.scalebound, { statuses: "all" }).map((r) => r.precision)).toEqual([
      "tbd",
      "tbd",
    ]);
  });

  test("releasesByPlatform() leaves out a platform the game was cancelled on", () => {
    expect(releasesByPlatform(cancelledPort).map((r) => r.platform)).toEqual([Platform.PCMicrosoftWindows]);
    expect(releasesByPlatform(cancelledPort, { statuses: "all" }).map((r) => [r.platform, r.status])).toEqual(
      [
        [Platform.WiiU, ReleaseDateStatus.Cancelled],
        [Platform.PCMicrosoftWindows, ReleaseDateStatus.FullRelease],
      ],
    );
  });
});

describe("companies()", () => {
  test("roles, with several regional publishers", () => {
    const result = companies(fixtures.witcher3);
    expect(result.developers.map((c) => c.name)).toEqual(["CD Projekt RED"]);
    expect(result.publishers.map((c) => c.name)).toEqual([
      "WB Games",
      "cdp.pl",
      "Spike Chunsoft",
      "Bandai Namco Entertainment",
    ]);
    expect(result.porting.map((c) => c.name)).toEqual(["Saber Interactive"]);
    expect(result.supporting.map((c) => c.name)).toEqual(["D3T Limited"]);
  });

  test("a company holding several roles", () => {
    const result = companies(fixtures.genshin);
    expect(result.developers.map((c) => c.id)).toEqual(result.publishers.map((c) => c.id));
  });

  test("a company listed twice appears once per role", () => {
    // Game 4: company 27 has one row as developer and another as publisher.
    const game = {
      involved_companies: [
        { id: 265439, company: 27, developer: true, porting: false, publisher: false, supporting: false },
        { id: 265440, company: 26, developer: false, porting: false, publisher: true, supporting: false },
        { id: 265441, company: 291, developer: false, porting: true, publisher: false, supporting: false },
        { id: 265442, company: 23, developer: false, porting: true, publisher: true, supporting: false },
        { id: 265443, company: 27, developer: false, porting: false, publisher: true, supporting: false },
      ],
    };
    expect(companies(game)).toEqual({
      developers: [27],
      publishers: [26, 23, 27],
      porting: [291, 23],
      supporting: [],
    });
  });

  test("none listed", () => {
    expect(companies(fixtures.mayaTheBee)).toEqual({
      developers: [],
      publishers: [],
      porting: [],
      supporting: [],
    });
  });
});

describe("storeLinks()", () => {
  test("from websites, deduplicated with external_games, with Amazon links built from the id", () => {
    const links = storeLinks(fixtures.witcher3);
    expect(links.map((l) => l.store)).toEqual([
      "epic",
      "steam",
      "gog",
      "xbox",
      "playstation",
      "nintendo",
      "amazon",
      "amazon",
      "amazon",
    ]);
    // GOG has two external_games rows and a website for one product.
    expect(links.find((l) => l.store === "gog")).toMatchObject({
      url: "https://www.gog.com/game/the_witcher_3_wild_hunt",
      trusted: true,
      source: "website",
    });
    // IGDB never trusts Xbox, PlayStation and Nintendo links; they are kept.
    expect(links.find((l) => l.store === "xbox")?.trusted).toBe(false);
    expect(links.filter((l) => l.store === "amazon")).toEqual([
      {
        store: "amazon",
        url: "https://amazon.co.jp/dp/B00T3SPV36",
        trusted: null,
        source: "external_game",
        built: true,
        platform: Platform.PlayStation4,
        countries: [392],
        format: GameReleaseFormat.Physical,
      },
      expect.objectContaining({ url: "https://amazon.com/dp/B00WTI2HV6", platform: Platform.XboxOne }),
      expect.objectContaining({
        url: "https://amazon.com/dp/B00WTI3SGO",
        platform: Platform.PCMicrosoftWindows,
      }),
    ]);
  });

  test("one link per product whatever the URL form", () => {
    // Epic: www.epicgames.com/p/x, store.epicgames.com/en-US/p/x and epicgames.com/store/p/x.
    // Apple: the iPhone and iPad links of one app. Xbox: xbox.com and the Game Pass microsoft.com link.
    expect(storeLinks(fixtures.genshin).map((l) => l.store)).toEqual([
      "apple",
      "epic",
      "google_play",
      "playstation",
      "xbox",
    ]);
    const silksong = storeLinks(fixtures.silksong);
    expect(silksong.filter((l) => l.store === "xbox").map((l) => l.url)).toEqual([
      "https://www.xbox.com/en-US/games/store/hollow-knight-silksong/9N116V0599HB/0010",
    ]);
    expect(silksong.filter((l) => l.store === "steam")).toHaveLength(1);
    // Two PlayStation links: a product (one edition) and a concept page.
    expect(silksong.filter((l) => l.store === "playstation")).toHaveLength(2);
  });

  test("builds verified URLs when external_games has none", () => {
    const links = storeLinks({
      external_games: [
        externalRows.steamWithoutUrl,
        externalRows.androidWithoutUrl,
        externalRows.amazonGermany,
        externalRows.amazonIndia,
      ],
    });
    expect(links.map((l) => [l.url, l.built])).toEqual([
      ["https://store.steampowered.com/app/1338610", true],
      ["https://play.google.com/store/apps/details?id=com.riotgames.league.teamfighttactics", true],
      ["https://amazon.de/dp/B07SV2KNHR", true],
      // IGDB's own URLs for products sold in India are on www.amazon.in.
      ["https://amazon.in/dp/B00HQEN7Y4", true],
    ]);
  });

  test("ignores links that are not live store pages", () => {
    const links = storeLinks({
      websites: Object.values(untrustedWebsites),
      external_games: [externalRows.xbox360Marketplace, externalRows.utomikApi, externalRows.utomik],
    });
    // The store comes from the address: an Xbox link typed as Epic is an Xbox link.
    expect(links.map((l) => [l.store, l.trusted])).toEqual([
      ["xbox", false],
      ["utomik", null],
    ]);
  });

  test("filters by store", () => {
    expect(storeLinks(fixtures.witcher3, { stores: ["steam", "gog"] }).map((l) => l.store)).toEqual([
      "steam",
      "gog",
    ]);
    expect(storeLinks(fixtures.mayaTheBee)).toEqual([]);
  });

  test("storeOf()", () => {
    expect(storeOf("https://store.steampowered.com/app/292030")).toBe("steam");
    expect(storeOf("https://psytronik.itch.io/im3-c64")).toBe("itch");
    expect(storeOf("https://www.nintendo.co.jp/n08/a3uj/index.html")).toBe("nintendo");
    expect(storeOf("https://www.thewitcher.com")).toBeNull();
    expect(storeOf("not a url")).toBeNull();
  });

  test("storeOf() reads a pasted address without its https://, storeLinks() only full URLs", () => {
    // parseStoreUrl() finds no id in it: storeOf() still names the store.
    expect(storeOf("www.nintendo.com/us/store/products/hollow-knight-silksong-switch")).toBe("nintendo");
    expect(storeOf(" store.steampowered.com/app/292030 ")).toBe("steam");
    expect(storeOf("www.thewitcher.com")).toBeNull();
    const pasted = "store.playstation.com/en-us/concept/10005908";
    expect(storeLinks({ websites: [{ url: pasted, trusted: false }] })).toEqual([]);
    expect(localizeStoreUrl(pasted, "fr-FR")).toBe(pasted);
  });

  test("storeOf() reads a mistyped https:// as storeLinks() does, and no address as null", () => {
    for (const url of [
      "https:/store.steampowered.com/app/292030",
      "http:store.steampowered.com/app/292030",
      "HTTPS:\\\\store.steampowered.com\\app\\292030",
    ]) {
      expect(storeLinks({ websites: [{ url, trusted: true }] }).map((l) => l.store)).toEqual(["steam"]);
      expect(storeOf(url)).toBe("steam");
    }
    expect(parseStoreUrl("https:/store.steampowered.com/app/292030")).toEqual({
      store: "steam",
      kind: "app",
      id: "292030",
    });
    // A websites row without its url, from JavaScript.
    expect(storeOf(undefined as never)).toBeNull();
    expect(parseStoreUrl(null as never)).toBeNull();
  });
});

describe("parseStoreUrl()", () => {
  test("one id per product, whatever the address", () => {
    const ids = (...urls: string[]) => urls.map(parseStoreUrl);
    expect(
      ids(
        "https://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/",
        "store.steampowered.com/app/1030300",
        " https://store.steampowered.com/agecheck/app/1030300/ ",
      ),
    ).toEqual(Array(3).fill({ store: "steam", kind: "app", id: "1030300" }));
    expect(
      ids(
        "https://www.xbox.com/en-US/games/store/hollow-knight-silksong/9N116V0599HB/0010",
        "https://www.microsoft.com/en-us/p/-1-/9n116v0599hb",
      ),
    ).toEqual(Array(2).fill({ store: "xbox", kind: "product", id: "9N116V0599HB" }));
    expect(
      ids(
        "https://www.gog.com/en/game/the_witcher_3_wild_hunt",
        "https://www.gog.com/game/The_Witcher_3_Wild_Hunt",
      ),
    ).toEqual(Array(2).fill({ store: "gog", kind: "slug", id: "the_witcher_3_wild_hunt" }));
    expect(
      ids(
        "https://store.epicgames.com/en-US/p/genshin-impact",
        "https://www.epicgames.com/store/p/genshin-impact",
        "https://www.epicgames.com/p/genshin-impact",
      ),
    ).toEqual(Array(3).fill({ store: "epic", kind: "slug", id: "genshin-impact" }));
    expect(
      ids("https://apps.apple.com/app/id1517783697", "https://itunes.apple.com/us/app/id1517783697"),
    ).toEqual(Array(2).fill({ store: "apple", kind: "app", id: "1517783697" }));
  });

  test("the kind of id, written as IGDB writes it", () => {
    expect(parseStoreUrl("https://store.playstation.com/en-us/concept/10005908")).toEqual({
      store: "playstation",
      kind: "concept",
      id: "10005908",
    });
    expect(
      parseStoreUrl("https://store.playstation.com/fr-fr/product/ep1805-ppsa12544_00-hksilksongps5000"),
    ).toEqual({ store: "playstation", kind: "product", id: "EP1805-PPSA12544_00-HKSILKSONGPS5000" });
    expect(parseStoreUrl(untrustedWebsites.xboxTypedAsEpic.url ?? "")).toEqual({
      store: "xbox",
      kind: "product",
      id: "9NP62V3X54XQ",
    });
    // A Google Play package name keeps its case.
    expect(parseStoreUrl("https://play.google.com/store/apps/details?id=com.miHoYo.GenshinImpact")).toEqual({
      store: "google_play",
      kind: "app",
      id: "com.miHoYo.GenshinImpact",
    });
    // An ASIN is the same on every country's site, where storeLinks() keeps a link per site: GTA V
    // has one on amazon.fr, amazon.es and amazon.it.
    const amazon = (gta5.external_games ?? []).flatMap((row) =>
      row.url?.includes("amazon.") ? [row.url] : [],
    );
    expect(storeLinks({ websites: amazon.map((url) => ({ url, trusted: false })) })).toHaveLength(3);
    expect([...amazon, "https://www.amazon.fr/dp/B09WZ6F8P5?th=1"].map(parseStoreUrl)).toEqual(
      Array(4).fill({ store: "amazon", kind: "product", id: "B09WZ6F8P5" }),
    );
    expect(parseStoreUrl("https://www.igdb.com/games/the-witcher-3-wild-hunt/presskit")).toEqual({
      store: "igdb",
      kind: "slug",
      id: "the-witcher-3-wild-hunt",
    });
    expect(parseStoreUrl("igdb.com/games/doom--1")).toEqual({ store: "igdb", kind: "slug", id: "doom--1" });
  });

  test("null without an id, or outside the stores", () => {
    for (const url of [
      "https://www.nintendo.com/us/store/products/hollow-knight-silksong-switch",
      "https://psytronik.itch.io/im3-c64",
      "https://store.steampowered.com/",
      // A slug, not a product id: twelve letters and no digit.
      "https://www.xbox.com/en-US/games/store/hollowknight",
      "https://www.igdb.com/platforms/switch",
      externalRows.xbox360Marketplace.url ?? "",
      untrustedWebsites.archivedSteam.url ?? "",
      "https://www.thewitcher.com",
      "not a url",
      "",
    ])
      expect(parseStoreUrl(url)).toBeNull();
  });

  test("gives the id externalIds() reads from IGDB's uid", () => {
    const ids = [fixtures.witcher3, fixtures.silksong, fixtures.genshin, gta5]
      .flatMap((game) => externalIds(game))
      .filter((e) => e.url && ["steam", "xbox", "playstation"].includes(e.storeId?.store ?? ""));
    expect(new Set(ids.map((e) => e.storeId?.kind))).toEqual(
      new Set(["app", "product", "concept", "xbox360_product"]),
    );
    // The Xbox 360 Marketplace is closed: its addresses are not store links.
    for (const e of ids)
      expect(parseStoreUrl(e.url ?? "")).toEqual(e.storeId?.kind === "xbox360_product" ? null : e.storeId);
    // Silksong's Microsoft Store id is only under XboxGamePassUltimateCloud.
    expect(externalIds(fixtures.silksong, ExternalGameSource.Microsoft)).toEqual([]);
    expect(externalIds(fixtures.silksong, ExternalGameSource.XboxGamePassUltimateCloud)[0]?.storeId).toEqual({
      store: "xbox",
      kind: "product",
      id: "9N116V0599HB",
    });
  });
});

describe("ageRating()", () => {
  test("label, minimum age, descriptors and synopsis", () => {
    const pegi = ageRating(fixtures.witcher3, AgeRatingOrganization.PEGI);
    expect(pegi).toMatchObject({
      organization: AgeRatingOrganization.PEGI,
      category: 12,
      label: "18",
      minimumAge: 18,
      descriptors: ["Violence", "Bad Language", "Sex"],
    });
    expect(pegi?.synopsis).toStartWith("The content of this game is suitable for persons aged 18 years");
    expect(ageRating(fixtures.witcher3, AgeRatingOrganization.CERO)).toMatchObject({
      label: "Z",
      minimumAge: 18,
    });
    expect(ageRating(fixtures.witcher3, AgeRatingOrganization.ACB)).toMatchObject({
      label: "R 18+",
      minimumAge: 18,
    });
  });

  test("the first organization that rated the game", () => {
    expect(ageRating(fixtures.gta6, [AgeRatingOrganization.PEGI, AgeRatingOrganization.ESRB])).toMatchObject({
      organization: AgeRatingOrganization.ESRB,
      label: "RP",
      minimumAge: null, // rating pending
    });
    expect(ageRating(fixtures.gta6, AgeRatingOrganization.PEGI)).toBeNull();
    expect(ageRating(fixtures.mayaTheBee, AgeRatingOrganization.PEGI)).toBeNull();
  });

  test("the strictest of two ratings from one organization", () => {
    expect(ageRating(fixtures.buriedAlive, AgeRatingOrganization.PEGI)?.label).toBe("18");
    expect(ageRating(fixtures.buriedAlive, AgeRatingOrganization.ESRB)).toMatchObject({
      label: "M",
      descriptors: ["Intense Violence", "Blood"],
    });
    expect(ageRatings(fixtures.buriedAlive).map((r) => `${r.organization}:${r.label}`)).toEqual([
      "4:18",
      "6:12",
      "1:M",
      "7:M",
      "2:18",
    ]);
  });

  test("an expanded rating_category gives the label; an unknown one has no minimum age", () => {
    const game = { age_ratings: [{ id: 1, organization: 2, rating_category: { id: 99, rating: "New" } }] };
    expect(ageRating(game, 2)).toMatchObject({
      category: 99,
      label: "New",
      minimumAge: null,
      descriptors: [],
      synopsis: null,
    });
  });
});

describe("localizedName()", () => {
  test("the localization of the locale's region", () => {
    expect(localizedName(fixtures.witcher3, "ja-JP")).toEqual({
      name: "ウィッチャー3 ワイルドハント",
      source: "localization",
      language: "ja-JP",
      variant: null,
    });
    expect(localizedName(fixtures.witcher3, "ko")).toEqual({
      name: "더 위쳐 3: 와일드 헌트",
      source: "localization",
      language: "ko-KR",
      variant: null,
    });
  });

  test("an alternative name in the locale's language", () => {
    expect(localizedName(fixtures.witcher3, "pl-PL")).toEqual({
      name: "Wiedźmin 3: Dziki Gon",
      source: "alternative_name",
      language: "pl",
      variant: null,
    });
    expect(localizedName(fixtures.witcher3, "ru")?.name).toBe("Ведьмак 3: Дикая охота"); // "Russian Title"
    expect(localizedName(fixtures.witcher3, "cs-CZ")?.name).toBe("Zaklínač 3: Divoký hon");
    expect(localizedName(fixtures.witcher3, "zh-TW")?.name).toBe("巫師3：狂獵");
    expect(localizedName(fixtures.witcher3, "zh-CN")?.name).toBe("巫师3：狂猎");
    expect(localizedName(fixtures.witcher3, "zh-Hant")?.name).toBe("巫師3：狂獵");
  });

  test("skips romanizations and translations", () => {
    // Persona 5 Royal: "Japanese title - romanization" is Latin script; the localization wins anyway.
    expect(localizedName(fixtures.persona5Royal, "ja-JP")?.source).toBe("localization");
    const romanized = {
      name: "Persona 5 Royal",
      alternative_names: fixtures.persona5Royal.alternative_names ?? [],
    };
    expect(localizedName(romanized, "ja-JP")).toMatchObject({ name: "Persona 5 Royal", source: "name" });
  });

  test("the European localization for a European country", () => {
    expect(localizedName(fixtures.monsterRancher2, "en-GB")).toEqual({
      name: "Monster Rancher",
      source: "localization",
      language: null,
      variant: null,
    });
    expect(localizedName(fixtures.monsterRancher2, "en-US")).toEqual({
      name: "Monster Rancher 2",
      source: "name",
      language: null,
      variant: null,
    });
    expect(localizedName(fixtures.monsterRancher2, "en")).toMatchObject({
      name: "Monster Rancher 2",
      source: "name",
    });
  });

  test("a localization without a name falls through", () => {
    // The Witcher 3 has a European localization with a cover but no name.
    expect(localizedName(fixtures.witcher3, "fr-FR")).toMatchObject({
      name: "The Witcher 3: Wild Hunt",
      source: "name",
    });
    expect(localization(fixtures.witcher3, "fr-FR")).toEqual({
      id: 48892,
      region: { id: 4, identifier: "EU" },
    });
    expect(localization(fixtures.witcher3, "en-US")).toBeNull();
  });

  test("regions given as ids", () => {
    const game = {
      name: "Monster Rancher 2",
      game_localizations: [
        { id: 62079, name: "モンスターファーム２", region: 3 },
        { id: 62080, name: "Monster Rancher", region: 4 },
      ],
    };
    expect(localizedName(game, "ja")?.name).toBe("モンスターファーム２");
    expect(localizedName(game, "de-DE")?.name).toBe("Monster Rancher");
  });

  test("only the name selected", () => {
    expect(localizedName({ id: 1, name: "Pong" }, "ja-JP")).toEqual({
      name: "Pong",
      source: "name",
      language: null,
      variant: null,
    });
    expect(localizedName({ id: 1 } as { id: number; name?: string }, "ja-JP")).toBeNull();
  });

  test("alternative names in the wrong script are skipped, unless marked original", () => {
    const named = (name: string, ...rows: [comment: string, name: string][]) => ({
      name,
      alternative_names: rows.map(([comment, n]) => ({ comment, name: n })),
    });
    // 28% of the "Japanese title" rows without a variant are romanizations.
    expect(
      localizedName(named("Persona 5 Royal", ["Japanese title", "Persona 5 The Royal"]), "ja")?.source,
    ).toBe("name");
    // Some official Japanese titles are in Latin letters.
    expect(
      localizedName(named("Resident Evil", ["Japanese title - original", "BIOHAZARD"]), "ja-JP"),
    ).toEqual({
      name: "BIOHAZARD",
      source: "alternative_name",
      language: "ja",
      variant: "original",
    });
    const mother = named(
      "Mother 3",
      ["Japanese title - stylized", "MOTHER３"],
      ["Japanese title - romanization", "Mazā Surī"],
      ["Japanese title", "マザー3"],
      ["Japanese title - original", "マザースリー"],
    );
    expect(localizedName(mother, "ja")?.name).toBe("マザースリー");
    // Pinyin labeled "simplified", and kana in a "Chinese title".
    const pinyin = named(
      "Genshin",
      ["Chinese title - simplified", "Yuanshen"],
      ["Chinese title", "げんしん"],
    );
    expect(localizedName(pinyin, "zh-CN")?.source).toBe("name");
    expect(localizedName(named("The Witcher 3", ["Russian title", "Vedmak 3"]), "ru")?.source).toBe("name");
  });

  test("translations only in the language's own script", () => {
    const game = {
      name: "Dragon Quest",
      alternative_names: [
        { comment: "Japanese title - translated", name: "Dragon Warrior" },
        { comment: "Korean title - translated", name: "드래곤 퀘스트" },
        { comment: "Portuguese title - translated", name: "Dragon Quest" },
        { comment: "Korean title - romanization", name: "Deuraegon Kweseuteu" },
      ],
    };
    expect(localizedName(game, "ja")?.source).toBe("name");
    expect(localizedName(game, "ko-KR")).toMatchObject({ name: "드래곤 퀘스트", variant: "translated" });
    expect(localizedName(game, "pt-BR")?.source).toBe("name");
  });

  test("countries and markets: Brazilian, Taiwanese, UK and North American titles", () => {
    const game = {
      name: "Puzzle Bobble",
      alternative_names: [
        { comment: "Portuguese title", name: "Bobble de Quebra-Cabeça" },
        { comment: "Brazilian title", name: "Bobble Quebra-Cabeça" },
        { comment: "Chinese title - simplified", name: "泡泡龙" },
        { comment: "Taiwanese title", name: "泡泡龍" },
        { comment: "North American title", name: "Bust-a-Move" },
        { comment: "Cancelled UK title", name: "Bubble Buster" },
        { comment: "Australian title", name: "Bust-a-Move Again" },
      ],
    };
    expect(localizedName(game, "pt-BR")?.name).toBe("Bobble Quebra-Cabeça");
    expect(localizedName(game, "pt-PT")?.name).toBe("Bobble de Quebra-Cabeça");
    expect(localizedName(game, "zh-TW")?.name).toBe("泡泡龍");
    expect(localizedName(game, "zh-HK")?.name).toBe("泡泡龍");
    expect(localizedName(game, "zh")?.name).toBe("泡泡龙");
    expect(localizedName(game, "en-US")).toMatchObject({ name: "Bust-a-Move", language: "en-US" });
    expect(localizedName(game, "en-AU")?.name).toBe("Bust-a-Move Again");
    // A market's title is not used elsewhere, nor a cancelled title.
    expect(localizedName(game, "en-GB")?.source).toBe("name");
    expect(localizedName(game, "en-CA")?.name).toBe("Bust-a-Move");
  });

  test("a Latin American title for Spanish in the Americas, as resolveLocale() picks", () => {
    const game = {
      name: "The Witcher 3: Wild Hunt",
      alternative_names: [
        { comment: "Spanish title", name: "The Witcher 3: Caza Salvaje" },
        { comment: "Latin America title", name: "El Brujo 3: Cacería Salvaje" },
      ],
    };
    for (const locale of ["es-419", "es-MX", "es-AR", "es-US", "es_419"])
      expect([locale, localizedName(game, locale)?.name]).toEqual([locale, "El Brujo 3: Cacería Salvaje"]);
    for (const locale of ["es-ES", "es", "es-IC"])
      expect([locale, localizedName(game, locale)?.name]).toEqual([locale, "The Witcher 3: Caza Salvaje"]);
  });
});

describe("resolveLocale()", () => {
  const { ESRB, PEGI, CERO, USK, CLASSIND } = AgeRatingOrganization;

  test("a full locale", () => {
    expect(resolveLocale("fr-FR")).toEqual({
      locale: "fr-FR",
      language: "fr",
      script: "Latn",
      country: "FR",
      releaseRegion: ReleaseDateRegion.Europe,
      localizationRegions: [Region.Europe],
      ageRatingOrganizations: [PEGI, ESRB],
      languages: [Language.French],
    });
    expect(resolveLocale("de-DE").ageRatingOrganizations).toEqual([USK, PEGI, ESRB]);
    expect(resolveLocale("de-AT").ageRatingOrganizations).toEqual([PEGI, ESRB]);
    expect(resolveLocale("pt_br")).toMatchObject({
      locale: "pt-BR",
      releaseRegion: ReleaseDateRegion.Brazil,
      ageRatingOrganizations: [CLASSIND, ESRB, PEGI],
      languages: [Language.PortugueseBrazil, Language.PortuguesePortugal],
    });
  });

  test("a locale without a country takes its likely one", () => {
    expect(resolveLocale("ja")).toMatchObject({
      script: "Jpan",
      country: "JP",
      releaseRegion: ReleaseDateRegion.Japan,
      localizationRegions: [Region.Japan],
      ageRatingOrganizations: [CERO, ESRB, PEGI],
      languages: [Language.Japanese],
    });
    expect(resolveLocale("en")).toMatchObject({
      country: "US",
      releaseRegion: ReleaseDateRegion.NorthAmerica,
      localizationRegions: [],
      ageRatingOrganizations: [ESRB, PEGI],
      languages: [Language.English, Language.EnglishUK],
    });
    expect(resolveLocale("zh")).toMatchObject({
      script: "Hans",
      country: "CN",
      releaseRegion: ReleaseDateRegion.China,
    });
  });

  test("language variants, best first", () => {
    expect(resolveLocale("en-GB").languages).toEqual([Language.EnglishUK, Language.English]);
    expect(resolveLocale("en-AU").languages).toEqual([Language.EnglishUK, Language.English]);
    expect(resolveLocale("en-CA").languages).toEqual([Language.English, Language.EnglishUK]);
    expect(resolveLocale("es").languages).toEqual([Language.SpanishSpain, Language.SpanishMexico]);
    expect(resolveLocale("es-AR").languages).toEqual([Language.SpanishMexico, Language.SpanishSpain]);
    expect(resolveLocale("es-419")).toMatchObject({
      country: "419",
      releaseRegion: null,
      ageRatingOrganizations: [ESRB, PEGI],
      languages: [Language.SpanishMexico, Language.SpanishSpain],
    });
    expect(resolveLocale("pt-PT").languages).toEqual([
      Language.PortuguesePortugal,
      Language.PortugueseBrazil,
    ]);
    expect(resolveLocale("zh-TW")).toMatchObject({
      script: "Hant",
      releaseRegion: ReleaseDateRegion.Asia,
      languages: [Language.ChineseTraditional, Language.ChineseSimplified],
    });
    expect(resolveLocale("zh-Hant").languages[0]).toBe(Language.ChineseTraditional);
    expect(resolveLocale("zh-HK").languages[0]).toBe(Language.ChineseTraditional);
    expect(resolveLocale("nb-NO").languages).toEqual([Language.Norwegian]);
    expect(resolveLocale("ca-ES")).toMatchObject({ releaseRegion: ReleaseDateRegion.Europe, languages: [] });
  });

  test("the language's localization comes before Europe", () => {
    expect(resolveLocale("ja-FR").localizationRegions).toEqual([Region.Japan, Region.Europe]);
    expect(resolveLocale("ko-US")).toMatchObject({
      localizationRegions: [Region.Korea],
      releaseRegion: ReleaseDateRegion.NorthAmerica,
    });
    // "eu" is Basque, spoken in Spain, not IGDB's "EU" region identifier.
    expect(resolveLocale("eu").localizationRegions).toEqual([Region.Europe]);
  });

  test("a string that is not a locale", () => {
    expect(resolveLocale("not a locale")).toMatchObject({
      releaseRegion: null,
      localizationRegions: [],
      ageRatingOrganizations: [],
      languages: [],
    });
    expect(resolveLocale("fr_FR_!").country).toBe("FR");
  });
});

describe("parseAlternativeName()", () => {
  const cases: [
    comment: string | undefined,
    kind: string,
    language: string | null,
    variant: string | null,
  ][] = [
    ["Windows Executable", "executable", null, null],
    ["windows executable", "executable", null, null],
    ["Alternative title", "alternative", null, "alternative"],
    ["Stylized title", "stylized", null, "stylized"],
    ["Alternative spelling", "spelling", null, "spelling"],
    ["Acronym", "abbreviation", null, "abbreviation"],
    ["Working title", "working", null, "working"],
    ["Japanese title - romanization", "language", "ja", "romanized"],
    ["Japanese title - stylized romanization", "language", "ja", "romanized"],
    ["Japanese title - translated", "language", "ja", "translated"],
    ["Japanese title - original (Game Boy Color)", "language", "ja", "original"],
    ["Japanese PSX title", "language", "ja", null],
    ["Former Japanese title", "language", "ja", "former"],
    ["Chinese title - simplified", "language", "zh-Hans", null],
    ["Chinese Traditional title", "language", "zh-Hant", null],
    ["Chinese spelling (Simplified)", "language", "zh-Hans", "spelling"],
    ["Chinese title - PinYin", "language", "zh", "romanized"],
    ["Chinese title", "language", "zh", null],
    ["Taiwanese title", "language", "zh-TW", null],
    ["Korean title - translated", "language", "ko", "translated"],
    ["Korean Acroynm", "language", "ko", "abbreviation"],
    ["Korean Ttitle", "language", "ko", null],
    ["Alternative title - Korean", "language", "ko", "alternative"],
    ["Brazilian title", "language", "pt-BR", null],
    ["Brazillian Title", "language", "pt-BR", null],
    ["Portuguese title (Brazilian)", "language", "pt-BR", null],
    ["Portugual title", "language", "pt", null],
    ["Israeli title", "language", "he", null],
    ["Isreal title", "language", "he", null],
    ["Germany title", "language", "de", null],
    ["Nederlands title", "language", "nl", null],
    ["Latin America title", "language", "es-419", null],
    ["English (UK) title", "language", "en-GB", null],
    ["French atlernative title", "language", "fr", "alternative"],
    ["Italian titile", "language", "it", null],
    ["UK title", "regional", "en-GB", null],
    ["U.S. Title", "regional", "en-US", null],
    ["North American title", "regional", "en-US", null],
    ["Cancelled North American title", "regional", "en-US", "working"],
    ["European title", "regional", null, null],
    ["PAL title", "regional", null, null],
    ["South American title", "regional", null, null],
    ["Steam title", "platform", null, null],
    ["Stean title", "platform", null, null],
    ["Mega Drive Title - romanization", "platform", null, "romanized"],
    ["Alternative Abberviation", "abbreviation", null, "abbreviation"],
    ["Full title", "other", null, null],
    ["Translated title", "other", null, "translated"],
    ["None", "other", null, null],
    ["", "other", null, null],
    [undefined, "other", null, null],
  ];
  for (const [comment, kind, language, variant] of cases) {
    test(`"${comment}"`, () => {
      expect(parseAlternativeName(comment)).toEqual({ kind, language, variant } as never);
    });
  }
});

describe("alternativeTitles()", () => {
  test("every name with what its comment says, without executables", () => {
    const titles = alternativeTitles(fixtures.witcher3);
    expect(titles).toHaveLength((fixtures.witcher3.alternative_names?.length ?? 0) - 1);
    expect(titles.some((t) => t.kind === "executable")).toBe(false);
    expect(titles.find((t) => t.name === "TW3")).toMatchObject({
      comment: "Acronym",
      kind: "abbreviation",
      language: null,
      variant: "abbreviation",
      row: { id: 74561 },
    });
    expect(titles.filter((t) => t.language?.startsWith("zh")).map((t) => t.language)).toEqual([
      "zh-Hans",
      "zh-Hant",
    ]);
    const blank = {
      alternative_names: [
        { id: 1, name: " ", comment: "Alternative title" },
        { id: 2, name: "X", comment: " " },
      ],
    };
    expect(alternativeTitles(blank)).toEqual([
      {
        name: "X",
        comment: null,
        kind: "other",
        language: null,
        variant: null,
        locale: null,
        inScript: null,
        row: { id: 2, name: "X", comment: " " },
      },
    ]);
  });

  test("the language each name is written in, by the rules of localizedName()", () => {
    const cases: [comment: string, name: string, locale: string | null, inScript: boolean | null][] = [
      ["Russian title", "Vedmak 3", null, false],
      ["Russian title", "Ведьмак 3", "ru", true],
      ["Greek title", "O Magos", null, false],
      ["Chinese title - simplified", "巫师3", "zh-Hans", true],
      ["Chinese title - traditional", "マリオ博士64", null, false],
      ["Japanese title", "Uitcha 3", null, false],
      ["Japanese title", "위쳐 3", null, false],
      ["Japanese title - original", "BIOHAZARD", "ja", false],
      ["Japanese title - translated", "Dragon Warrior", null, false],
      ["Japanese title - translated", "ラストウィンドウ 真夜中の約束", "ja", true],
      ["Japanese title - romanization", "Mazā Surī", null, false],
      // Still written in Japanese: localizedName() leaves out former titles by their variant.
      ["Former Japanese title", "バイオハザード", "ja", true],
      ["Korean title - translated", "드래곤 퀘스트", "ko", true],
      ["Korean title - romanization", "Deuraegon Kweseuteu", null, false],
      ["Portuguese title - translated", "Dragon Quest", null, true],
      ["Brazilian title", "O Bruxo 3", "pt-BR", true],
      ["Serbian title", "Цанди Блитз Делуке", "sr", true],
      // The script is only checked for the languages not written in Latin letters.
      ["French title", "ウィッチャー3", "fr", true],
      ["UK title", "Bubble Buster", "en-GB", true],
      ["North American title", "Bust-a-Move", "en-US", true],
      ["European title", "Monster Rancher", null, null],
      ["Steam title", "The Witcher 3", null, null],
      ["Acronym", "TW3", null, null],
    ];
    const rows = cases.map(([comment, name]) => ({ comment, name }));
    expect(
      alternativeTitles({ alternative_names: rows }).map((t) => [t.comment, t.name, t.locale, t.inScript]),
    ).toEqual(cases);
    // localizedName() takes a name in its language exactly when it has a locale and is a current title.
    const notCurrent = new Set(["abbreviation", "unofficial", "working", "former"]);
    const games = [fixtures.witcher3, fixtures.mother3, fixtures.persona5Royal, { alternative_names: rows }];
    for (const t of games.flatMap((game) => alternativeTitles(game))) {
      if (t.language === null) continue;
      const taken = localizedName({ name: "Game", alternative_names: [t.row] }, t.language);
      expect([t.name, taken?.source === "alternative_name"]).toEqual([
        t.name,
        t.locale !== null && !notCurrent.has(t.variant ?? ""),
      ]);
    }
  });
});

describe("localizedCover()", () => {
  const game = {
    cover: { id: 1, image_id: "main" },
    game_localizations: [
      { id: 865, region: { id: 2 }, cover: { id: 494149, image_id: "coalad" } },
      { id: 11578, region: 3, cover: { id: 537893, image_id: "cobj1h" } },
      { id: 12000, region: 4, cover: 12 },
    ],
  };

  test("the localization's cover for the locale, then the game's", () => {
    expect(localizedCover(game, "ja-JP")).toEqual({ image_id: "cobj1h", source: "localization", region: 3 });
    expect(localizedCover(game, "ko")).toEqual({ image_id: "coalad", source: "localization", region: 2 });
    expect(localizedCover(game, "ja-FR")?.image_id).toBe("cobj1h");
    // The European localization's cover is not expanded: the game's cover is used.
    expect(localizedCover(game, "fr-FR")).toEqual({ image_id: "main", source: "cover", region: null });
    expect(localizedCover(game, "en-US")).toEqual({ image_id: "main", source: "cover", region: null });
  });

  test("Europe for a European country, and null without any cover", () => {
    type Cover = { id: number; image_id: string };
    const european: {
      cover?: Cover | undefined;
      game_localizations: { id: number; region: number; cover: Cover }[];
    } = {
      game_localizations: [{ id: 1, region: 4, cover: { id: 2, image_id: "eu" } }],
    };
    expect(localizedCover(european, "de-AT")).toEqual({ image_id: "eu", source: "localization", region: 4 });
    expect(localizedCover(european, "en-US")).toBeNull();
    expect(localizedCover({ cover: { id: 1, image_id: "" }, game_localizations: [] }, "fr")).toBeNull();
  });
});

describe("languages()", () => {
  test("audio, subtitles and interface per language", () => {
    const result = languages(fixtures.witcher3);
    expect(result).toHaveLength(19);
    const byLocale = Object.fromEntries(result.map((l) => [l.language.locale, l]));
    expect(byLocale["fr-FR"]).toMatchObject({ audio: true, subtitles: true, interface: true });
    expect(byLocale["it-IT"]).toMatchObject({ audio: false, subtitles: true, interface: true });
    expect(byLocale["fr-FR"]?.language.native_name).toBe("Français");
  });

  test("unknown when the game has no data of that kind", () => {
    expect(languages(fixtures.mother3)).toEqual([
      {
        language: { id: 16, native_name: "日本語", locale: "ja-JP" },
        audio: null,
        subtitles: null,
        interface: true,
      },
    ]);
    expect(languages(fixtures.mayaTheBee as { id: number; language_supports?: never[] })).toEqual([]);
  });
});

describe("timeToBeat() and formatPlaytime()", () => {
  test("picks normally, then hastily, then completely", () => {
    expect(timeToBeat(timeToBeatRows.witcher3)).toEqual({ seconds: 254778, kind: "normally", count: 41 });
    expect(timeToBeat(timeToBeatRows.hastilyOnly)).toEqual({ seconds: 154920, kind: "hastily", count: 1 });
    expect(timeToBeat(timeToBeatRows.witcher3, { prefer: ["completely"] })?.seconds).toBe(581483);
    const row = { hastily: undefined, normally: 3600, completely: undefined, count: undefined };
    expect(timeToBeat(row)).toEqual({ seconds: 3600, kind: "normally", count: null });
    expect(timeToBeat(timeToBeatRows.empty)).toBeNull();
    expect(timeToBeat(null)).toBeNull();
    expect(timeToBeat(undefined)).toBeNull();
  });

  test("keeps IGDB's averages as they are", () => {
    expect(timeToBeat(timeToBeatRows.fortnite, { prefer: ["hastily"] })?.seconds).toBeGreaterThan(
      timeToBeat(timeToBeatRows.fortnite)?.seconds ?? 0,
    );
  });

  test("formats minutes, half hours and hours", () => {
    expect(formatPlaytime(254778, { locale: "en-US" })).toBe("71 hr");
    expect(formatPlaytime(2700, { locale: "en-US" })).toBe("45 min");
    expect(formatPlaytime(9000, { locale: "en-US" })).toBe("2.5 hr");
    expect(formatPlaytime(10, { locale: "en-US" })).toBe("1 min");
    expect(formatPlaytime(3590, { locale: "en-US" })).toBe("1 hr");
    expect(formatPlaytime(254778, { locale: "en-US", unitDisplay: "long" })).toBe("71 hours");
    expect(formatPlaytime(254778, { locale: "fr-FR" })).toMatch(/^71\sh$/); // narrow no-break space
    expect(formatPlaytime(undefined)).toBeNull();
    expect(formatPlaytime(0)).toBeNull();
  });
});

describe("multiplayer()", () => {
  test("per platform, with 0 and missing counts as unknown", () => {
    expect(multiplayer(fixtures.watchDogs)).toEqual([
      {
        platform: Platform.PCMicrosoftWindows,
        onlineMax: null,
        onlineCoop: true,
        onlineCoopMax: 2,
        offlineMax: null,
        offlineCoop: false,
        offlineCoopMax: null,
        lanCoop: false,
        splitscreen: false,
        dropIn: true,
        campaignCoop: false,
      },
      expect.objectContaining({ platform: Platform.XboxOne, onlineMax: 8, onlineCoopMax: null }),
      expect.objectContaining({ platform: null, onlineMax: null, onlineCoop: false }),
    ]);
  });

  test("one platform, else the row for every platform", () => {
    expect(multiplayer(fixtures.watchDogs, Platform.XboxOne)?.onlineMax).toBe(8);
    expect(multiplayer(fixtures.watchDogs, Platform.PlayStation4)?.platform).toBeNull();
    expect(multiplayer(fixtures.pong, Platform.PCMicrosoftWindows)).toMatchObject({ offlineMax: 2 });
    expect(multiplayer(fixtures.witcher3, Platform.PCMicrosoftWindows)).toBeNull();
    expect(multiplayer(fixtures.witcher3)).toEqual([]);
  });
});

describe("parentGame()", () => {
  test("editions", () => {
    expect(parentGame(fixtures.codGhostsGold)).toEqual({
      relation: "edition",
      game: 2033,
      title: "Gold Edition",
    });
    // A bundle (game_type 3) that is also an edition of the main game.
    expect(parentGame(fixtures.witcher3Complete)).toMatchObject({ relation: "edition", game: 1942 });
  });

  test("parent_game, named from game_type", () => {
    expect(parentGame(fixtures.shadowOfTheErdtree)).toEqual({
      relation: "expansion",
      game: { id: 119133, name: "Elden Ring" },
      title: null,
    });
    expect(parentGame(fixtures.persona5Royal)?.relation).toBe("expanded_game");
    expect(parentGame(fixtures.scalebound)?.relation).toBe("remake");
    expect(parentGame({ game_type: 99, parent_game: 1, version_parent: undefined })?.relation).toBe("other");
  });

  test("standalone games", () => {
    expect(parentGame(fixtures.witcher3)).toBeNull();
  });
});

describe("formatReleaseDate()", () => {
  const start = new Date(Date.UTC(2026, 10, 19));
  const at = (precision: "day" | "month" | "quarter" | "year" | "tbd") => ({
    precision,
    start: precision === "tbd" ? null : start,
    year: precision === "tbd" ? null : 2026,
    quarter: precision === "quarter" ? 4 : null,
  });

  test("each precision, in the user's language", () => {
    const all = (locale: string) =>
      (["day", "month", "quarter", "year", "tbd"] as const).map((p) => formatReleaseDate(at(p), { locale }));
    expect(all("en-US")).toEqual(["Nov 19, 2026", "Nov 2026", "Q4 2026", "2026", "TBD"]);
    expect(all("fr-FR")).toEqual(["19 nov. 2026", "nov. 2026", "T4 2026", "2026", "À déterminer"]);
    expect(all("ja-JP")).toEqual(["2026/11/19", "2026年11月", "2026年第4四半期", "2026年", "未定"]);
    expect(all("zh-TW").slice(2)).toEqual(["2026年第4季", "2026年", "待定"]);
    expect(all("ko").slice(2, 3)).toEqual(["2026년 4분기"]);
    // No table for Swedish: English quarters and TBD, Intl for the rest.
    expect(all("sv-SE").slice(2)).toEqual(["Q4 2026", "2026", "TBD"]);
    // An underscore, as in some servers' locales, which Intl rejects.
    expect(all("pt_BR")).toEqual([
      "19 de nov. de 2026",
      "nov. de 2026",
      "4º trimestre de 2026",
      "2026",
      "A definir",
    ]);
  });

  test("date styles and labels", () => {
    expect(formatReleaseDate(at("day"), { locale: "fr-FR", dateStyle: "long" })).toBe("19 novembre 2026");
    expect(formatReleaseDate(at("month"), { locale: "fr-FR", dateStyle: "long" })).toBe("novembre 2026");
    expect(formatReleaseDate(at("day"), { locale: "en-GB", dateStyle: "short" })).toBe("19/11/2026");
    const labels = { tbd: "Bald", quarter: (q: number, y: number) => `${y}-Q${q}` };
    expect(formatReleaseDate(at("tbd"), { locale: "sv", labels })).toBe("Bald");
    expect(formatReleaseDate(at("quarter"), { locale: "sv", labels })).toBe("2026-Q4");
    // The day is IGDB's UTC day, whatever the machine's zone.
    const release = releaseDate(fixtures.witcher3);
    if (release) expect(formatReleaseDate(release, { locale: "en-US" })).toBe("May 19, 2015");
  });

  test("a date stored with its precision", () => {
    const fr = { locale: "fr-FR" };
    expect(formatReleaseDate({ date: "2026-10-01", precision: "quarter" }, fr)).toBe("T4 2026");
    // IGDB's own date of a quarter or a year is its last day.
    expect(formatReleaseDate({ date: "2026-12-31", precision: "quarter" }, fr)).toBe("T4 2026");
    expect(formatReleaseDate({ date: Date.UTC(2026, 11, 31) / 1000, precision: "year" }, fr)).toBe("2026");
    expect(formatReleaseDate({ date: "2027-01-01", precision: "year" }, fr)).toBe("2027");
    expect(formatReleaseDate({ date: new Date("2026-11-01"), precision: "month" }, fr)).toBe("nov. 2026");
    expect(formatReleaseDate({ date: "2015-05-19", precision: "day" }, fr)).toBe("19 mai 2015");
    expect(formatReleaseDate({ date: null, precision: "tbd" }, fr)).toBe("À déterminer");
    // IGDB leaves `date` out of TBD rows.
    expect(formatReleaseDate({ date: undefined, precision: "tbd" }, fr)).toBe("À déterminer");
    // A result of releaseDate() that went through JSON.
    const json = { precision: "quarter", start: "2026-10-01T00:00:00.000Z" } as const;
    expect(formatReleaseDate(json, fr)).toBe("T4 2026");
    expect(() => formatReleaseDate({ date: "soon", precision: "day" }, fr)).toThrow(QueryError);
    expect(() => formatReleaseDate({ date: Date.now(), precision: "day" }, fr)).toThrow(QueryError);
  });

  test("a missing year or quarter is read from the date", () => {
    const en = { locale: "en-US" };
    const start = new Date(Date.UTC(2026, 9, 1));
    expect(formatReleaseDate({ precision: "quarter", start }, en)).toBe("Q4 2026");
    expect(formatReleaseDate({ precision: "quarter", start, year: 2026, quarter: null }, en)).toBe("Q4 2026");
    expect(formatReleaseDate({ precision: "year", start, year: null }, en)).toBe("2026");
  });

  test("Gregorian dates in every locale, as IGDB's", () => {
    const all = (locale: string) =>
      (["day", "month", "quarter", "year"] as const).map((p) => formatReleaseDate(at(p), { locale }));
    // Not the Buddhist era (2569) next to "Q4 2026".
    expect(all("th-TH")).toEqual(["19 พ.ย. 2026", "พ.ย. 2026", "Q4 2026", "2026"]);
    // Not the Persian year, 1404 until March 2026 and 1405 after.
    expect(all("fa-IR")).toEqual(["۱۹ نوامبر ۲۰۲۶", "نوامبر ۲۰۲۶", "Q4 2026", "۲۰۲۶"]);
    expect(formatReleaseDate({ date: "2026-01-01", precision: "year" }, { locale: "fa-IR" })).toBe("۲۰۲۶");
    expect(formatReleaseDate(at("year"), { locale: "he-IL-u-ca-hebrew" })).toBe("2026");
    expect(formatReleaseDate(at("day"), { locale: "ja-JP-u-ca-japanese" })).toBe("2026/11/19");
  });
});

describe("names of regions, countries and languages", () => {
  test("releaseRegionName()", () => {
    expect(releaseRegionName(ReleaseDateRegion.Europe, "fr-FR")).toBe("Europe");
    expect(releaseRegionName(ReleaseDateRegion.NorthAmerica, "fr-FR")).toBe("Amérique du Nord");
    expect(releaseRegionName(ReleaseDateRegion.Japan, "de")).toBe("Japan");
    expect(releaseRegionName(ReleaseDateRegion.Worldwide, "fr")).toBe("Monde");
    expect(releaseRegionName(99, "fr")).toBeNull();
  });

  test("countryName() reads IGDB's numeric codes", () => {
    expect(countryName(250, "fr-FR")).toBe("France");
    expect(countryName(840, "de")).toBe("Vereinigte Staaten");
    expect(countryName("jp", "en")).toBe("Japan");
    expect(countryName(732, "en")).toBe("Western Sahara");
    expect(countryName(999, "en")).toBeNull();
    expect(countryName("EU", "en")).not.toBe("Basque");
  });

  test("languageName() names IGDB's languages", () => {
    expect(languageName(Language.ChineseSimplified, "fr")).toBe("chinois simplifié");
    expect(languageName(Language.EnglishUK, "en")).toBe("British English");
    expect(languageName("es-MX", "en")).toBe("Latin American Spanish");
    expect(languageName("zh-TW", "en")).toBe("Traditional Chinese");
    expect(languageName("zh-cn", "en")).toBe("Simplified Chinese");
    expect(languageName(Language.German, "fr", { native: true })).toBe("Deutsch");
    expect(languageName(Language.Japanese, "en", { native: true })).toBe("日本語");
    expect(languageName(99, "en")).toBeNull();
  });
});

describe("underscore locales", () => {
  test("pt_BR is pt-BR in every display helper", () => {
    const release = {
      precision: "day",
      start: new Date(Date.UTC(2026, 10, 19)),
      year: 2026,
      quarter: null,
    } as const;
    expect(formatReleaseDate(release, { locale: "pt_BR" })).toBe("19 de nov. de 2026");
    expect(formatPlaytime(7200, { locale: "pt_BR" })).toBe("2 h");
    expect(formatPlaytime(7200, { locale: ["pt_BR", "en"] })).toBe("2 h");
    const event = { id: 1, start_time: 1781110800, time_zone: "PST" };
    expect(eventTime(event, { locale: "pt_BR" }).text).toBe(eventTime(event, { locale: "pt-BR" }).text);
    expect(releaseRegionName(ReleaseDateRegion.Europe, "pt_BR")).toBe("Europa");
    expect(countryName(250, "pt_BR")).toBe("França");
    expect(languageName(Language.French, "pt_BR")).toBe(languageName(Language.French, "pt-BR"));
    expect(languageName("zh_TW", "en")).toBe("Traditional Chinese");
  });
});

describe("eventTime()", () => {
  // Summer Game Fest style: 10:00 Pacific time.
  const event = { id: 1, start_time: 1781110800, end_time: 1781118000, time_zone: "PST" };

  test("IGDB's abbreviations become IANA zones", () => {
    expect(eventTime(event, { locale: "en-US" })).toEqual({
      start: new Date("2026-06-10T17:00:00Z"),
      end: new Date("2026-06-10T19:00:00Z"),
      timeZone: "America/Los_Angeles",
      text: "Jun 10, 2026, 10:00 AM PDT",
    });
    for (const [abbreviation, zone] of [
      ["EST", "America/New_York"],
      ["JST", "Asia/Tokyo"],
      ["CET", "Europe/Berlin"],
      ["GMT", "Europe/London"],
      ["UTC", "UTC"],
      ["Europe/Paris", "Europe/Paris"],
      ["XYZ", null],
    ] as const)
      expect(eventTime({ ...event, time_zone: abbreviation }, { locale: "en" }).timeZone).toBe(zone);
  });

  test("in the user's zone", () => {
    expect(eventTime(event, { locale: "fr-FR", timeZone: "Europe/Paris" }).text).toBe(
      "10 juin 2026, 19:00 UTC+2",
    );
    expect(eventTime({ id: 2, start_time: undefined, time_zone: "PST" }, { locale: "en" })).toEqual({
      start: null,
      end: null,
      timeZone: "America/Los_Angeles",
      text: null,
    });
  });
});

describe("regionalReleases()", () => {
  test("one release per region, earliest first", () => {
    // Hades on Switch: worldwide and North America in 2020, then Europe and Japan.
    expect(
      regionalReleases(fixtures.hades, { platform: Platform.NintendoSwitch }).map((r) => [r.region, r.human]),
    ).toEqual([
      [ReleaseDateRegion.NorthAmerica, "Sep 17, 2020"],
      [ReleaseDateRegion.Worldwide, "Sep 17, 2020"],
      [ReleaseDateRegion.Europe, "Mar 18, 2021"],
      [ReleaseDateRegion.Japan, "Jun 24, 2021"],
    ]);
    expect(regionalReleases(fixtures.hades)[0]).toMatchObject({
      region: ReleaseDateRegion.Worldwide,
      year: 2020,
    });
    expect(regionalReleases({ release_dates: [] })).toEqual([]);
  });

  test("leaves out a region whose release was cancelled", () => {
    expect(regionalReleases(cancelledInEurope).map((r) => r.region)).toEqual([ReleaseDateRegion.Japan]);
    expect(regionalReleases(cancelledInEurope, { statuses: "all" }).map((r) => r.region)).toEqual([
      ReleaseDateRegion.Japan,
      ReleaseDateRegion.Europe,
    ]);
  });
});

describe("languages() and supportsLanguage() with a locale", () => {
  test("the user's languages first", () => {
    const order = (locale?: string) =>
      languages(fixtures.witcher3, { locale })
        .slice(0, 3)
        .map((l) => l.language.locale);
    expect(order()).toEqual(["pl-PL", "de-DE", "en-US"]);
    expect(order("fr-FR")).toEqual(["fr-FR", "pl-PL", "de-DE"]);
    expect(order("en-GB")[0]).toBe("en-GB");
  });

  test("audio, subtitles and interface in the user's language", () => {
    expect(supportsLanguage(fixtures.witcher3, "fr-CA")).toEqual({
      language: Language.French,
      audio: true,
      subtitles: true,
      interface: true,
    });
    const game = {
      language_supports: [
        { id: 1, language: Language.SpanishSpain, language_support_type: LanguageSupportType.Subtitles },
        { id: 2, language: Language.English, language_support_type: LanguageSupportType.Audio },
      ],
    };
    // Spanish (Spain) counts for Mexico; no interface data at all is unknown.
    expect(supportsLanguage(game, "es-MX")).toEqual({
      language: Language.SpanishSpain,
      audio: false,
      subtitles: true,
      interface: null,
    });
    expect(supportsLanguage(game, "ja")).toEqual({
      language: null,
      audio: false,
      subtitles: false,
      interface: null,
    });
    expect(supportsLanguage({ language_supports: [] }, "fr")).toEqual({
      language: null,
      audio: null,
      subtitles: null,
      interface: null,
    });
  });
});

describe("ageRating() with a locale", () => {
  test("the country's organization, then ESRB and PEGI", () => {
    const rated = (locale: string) => ageRating(fixtures.witcher3, { locale });
    expect(rated("de-DE")).toMatchObject({ organization: AgeRatingOrganization.USK, label: "18" });
    expect(rated("fr-FR")).toMatchObject({ organization: AgeRatingOrganization.PEGI, label: "18" });
    expect(rated("ja-JP")).toMatchObject({ organization: AgeRatingOrganization.CERO, label: "Z" });
    expect(rated("en-US")).toMatchObject({ organization: AgeRatingOrganization.ESRB, label: "M" });
    expect(rated("en-AU")).toMatchObject({ organization: AgeRatingOrganization.ACB, label: "R 18+" });
    const esrbOnly = {
      age_ratings: [{ id: 1, organization: AgeRatingOrganization.ESRB, rating_category: 6 }],
    };
    expect(ageRating(esrbOnly, { locale: "de-DE" })?.label).toBe("M");
    expect(ageRating({ age_ratings: [] }, { locale: "fr" })).toBeNull();
  });
});

describe("storeLinks() with a locale", () => {
  test("store pages in the user's language, Amazon products of the user's country", () => {
    const urls = (locale: string) => storeLinks(fixtures.witcher3, { locale }).map((l) => l.url);
    expect(urls("fr-FR")).toEqual([
      "https://www.epicgames.com/store/fr/product/the-witcher-3-wild-hunt/home",
      "https://store.steampowered.com/app/292030",
      "https://www.gog.com/fr/game/the_witcher_3_wild_hunt",
      "https://www.xbox.com/fr-fr/games/store/the-witcher-3-wild-hunt/BR765873CQJD",
      "https://store.playstation.com/fr-fr/concept/204794",
      "https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/",
    ]);
    expect(urls("ja-JP").filter((url) => url.includes("amazon"))).toEqual([
      "https://amazon.co.jp/dp/B00T3SPV36",
    ]);
    expect(urls("en-US").filter((url) => url.includes("amazon"))).toHaveLength(2);
    expect(urls("es-419")[0]).toBe(
      "https://www.epicgames.com/store/es-MX/product/the-witcher-3-wild-hunt/home",
    );
  });

  test("localizeStoreUrl()", () => {
    const concept = "https://store.playstation.com/en-us/concept/10005908";
    expect(localizeStoreUrl(concept, "de-AT")).toBe("https://store.playstation.com/de-at/concept/10005908");
    expect(localizeStoreUrl(concept, "fr-CA")).toBe("https://store.playstation.com/fr-ca/concept/10005908");
    // Not a language of the country, a product page tied to a region, or Chinese: unchanged.
    expect(localizeStoreUrl(concept, "fr-US")).toBe(concept);
    const product = "https://store.playstation.com/en-us/product/EP1805-PPSA12544_00-HKSILKSONGPS5000";
    expect(localizeStoreUrl(product, "fr-FR")).toBe(product);
    expect(localizeStoreUrl(concept, "zh-TW")).toBe(concept);
    expect(
      localizeStoreUrl(
        "https://www.xbox.com/en-US/games/store/hollow-knight-silksong/9N116V0599HB/0010",
        "pt-BR",
      ),
    ).toBe("https://www.xbox.com/pt-BR/games/store/hollow-knight-silksong/9N116V0599HB/0010");
    expect(localizeStoreUrl("https://www.microsoft.com/en-us/p/-1-/9N116V0599HB", "ko")).toBe(
      "https://www.microsoft.com/ko-kr/p/-1-/9N116V0599HB",
    );
    // Epic's Latin American Spanish where resolveLocale() picks it, its Spain Spanish elsewhere.
    for (const [locale, tag] of [
      ["es-AR", "es-MX"],
      ["es-419", "es-MX"],
      ["es_419", "es-MX"],
      ["es-US", "es-MX"],
      ["es-PY", "es-MX"],
      ["es-ES", "es-ES"],
      ["es", "es-ES"],
      ["es-IC", "es-ES"],
    ] as const)
      expect([locale, localizeStoreUrl("https://store.epicgames.com/en-US/p/hades", locale)]).toEqual([
        locale,
        `https://store.epicgames.com/${tag}/p/hades`,
      ]);
    expect(localizeStoreUrl("https://store.epicgames.com/p/hades", "zh-TW")).toBe(
      "https://store.epicgames.com/zh-Hant/p/hades",
    );
    expect(localizeStoreUrl("https://store.epicgames.com/en-US/p/hades", "sv")).toBe(
      "https://store.epicgames.com/en-US/p/hades",
    );
    expect(localizeStoreUrl("https://www.gog.com/en/game/hades", "pl-PL")).toBe(
      "https://www.gog.com/pl/game/hades",
    );
    const apple = "https://apps.apple.com/us/app/hades/id1234567890";
    expect(localizeStoreUrl(apple, "fr-FR")).toBe(apple);
    expect(localizeStoreUrl("not a url", "fr-FR")).toBe("not a url");
  });
});
