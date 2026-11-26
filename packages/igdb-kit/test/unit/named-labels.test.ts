import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../../src";
import { fr } from "../../src/i18n/fr";
import { ja } from "../../src/i18n/ja";
import { zhCN } from "../../src/i18n/zh-CN";
import { mockFetch, testClient } from "./helpers";

const GENRES = [
  { id: 11, name: "Real Time Strategy (RTS)" },
  { id: 12, name: "Role-playing (RPG)" },
  { id: 31, name: "Adventure" },
];

function api() {
  return mockFetch((call) => Response.json(call.url.endsWith("/genres") ? GENRES : [{ id: 1942 }]));
}
const gamesBodies = (calls: { url: string; body: string }[]) =>
  calls.filter((c) => c.url.endsWith("/games")).map((c) => c.body);

describe("named() with the client's labels", () => {
  test("matches translated labels and their parts, after one read of the table", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch, { labels: [fr, ja] });
    await igdb.games.where((g) => g.genres.named("Jeu de rôle", "アドベンチャー"));
    await igdb.games.where((g) => g.genres.named("STR", "ロールプレイング (RPG)", "Adventure"));
    expect(mock.calls.filter((c) => c.url.endsWith("/genres")).map((c) => c.body)).toEqual([
      "fields id,name; sort id asc; limit 500;",
    ]);
    expect(gamesBodies(mock.calls)).toEqual(["where genres = (12,31);", "where genres = (11,12,31);"]);
  });

  test("splits labels written with full-width parentheses", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch, { labels: [zhCN] });
    await igdb.games.where((g) => g.genres.named("角色扮演"));
    expect(gamesBodies(mock.calls)).toEqual(["where genres = (12);"]);
  });

  test("ignores Latin accents and case, but keeps the kana voicing marks", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch, { labels: [fr, ja] });
    await igdb.games.where((g) => g.genres.named("jeu de role", "STRATÉGIE EN TEMPS RÉEL"));
    expect(gamesBodies(mock.calls)).toEqual(["where genres = (11,12);"]);
    // "アトヘンチャー" is "アドベンチャー" without its voicing marks: another word.
    const error = await igdb.games
      .where((g) => g.genres.named("アトヘンチャー"))
      .execute()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  test("suggests IGDB's name when it contains the text, else the label that does", async () => {
    const igdb = testClient(api().fetch, { labels: [fr] });
    const suggest = (name: string) =>
      igdb.games
        .where((g) => g.genres.named(name))
        .execute()
        .catch((e: NotFoundError) => e.suggestions);
    expect(await suggest("aventur")).toEqual(["Aventure"]);
    expect(await suggest("rôle")).toEqual(["Role-playing (RPG)"]);
    expect(await suggest("ＲＰ")).toEqual(["Role-playing (RPG)"]);
  });

  test("without labels, only IGDB's English names match", async () => {
    const igdb = testClient(api().fetch);
    const error = await igdb.games
      .where((g) => g.genres.named("Jeu de rôle"))
      .execute()
      .catch((e: unknown) => e);
    expect((error as NotFoundError).message).toBe('No genre named "Jeu de rôle"');
  });
});
