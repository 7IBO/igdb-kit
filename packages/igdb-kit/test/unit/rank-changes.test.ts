import { describe, expect, test } from "bun:test";
import { type RankChangeRow, rankChanges } from "../../src";

const row = (game_id: number, rank: number, popularity_type = 1, value = 1 / rank): RankChangeRow => ({
  game_id,
  popularity_type,
  rank,
  value,
});

describe("rankChanges()", () => {
  test("says which games rose, fell, stayed, entered or left, ranked by today's rank", () => {
    const before = [row(10, 1), row(20, 2), row(30, 3), row(40, 4)];
    const after = [row(20, 1), row(10, 2), row(30, 3), row(50, 4)];
    expect(rankChanges(before, after)).toEqual([
      {
        game_id: 20,
        popularity_type: 1,
        status: "up",
        change: 1,
        before: { rank: 2, value: 0.5 },
        after: { rank: 1, value: 1 },
      },
      {
        game_id: 10,
        popularity_type: 1,
        status: "down",
        change: -1,
        before: { rank: 1, value: 1 },
        after: { rank: 2, value: 0.5 },
      },
      {
        game_id: 30,
        popularity_type: 1,
        status: "same",
        change: 0,
        before: { rank: 3, value: 1 / 3 },
        after: { rank: 3, value: 1 / 3 },
      },
      {
        game_id: 50,
        popularity_type: 1,
        status: "entered",
        change: null,
        before: null,
        after: { rank: 4, value: 0.25 },
      },
      {
        game_id: 40,
        popularity_type: 1,
        status: "left",
        change: null,
        before: { rank: 4, value: 0.25 },
        after: null,
      },
    ]);
  });

  test("keeps metrics apart, in the order of after, and leaves out a metric missing on one side", () => {
    const before = [row(1, 1, 5), row(2, 2, 5), row(1, 1, 3), row(9, 1, 34)];
    const after = [row(1, 1, 3), row(2, 1, 5), row(1, 2, 5), row(7, 1, 99)];
    const got = rankChanges(before, after).map((c) => [c.popularity_type, c.game_id, c.status]);
    expect(got).toEqual([
      [3, 1, "same"],
      [5, 2, "up"],
      [5, 1, "down"],
    ]);
  });

  test("ranks games that left by their former rank, ties by id, and keeps the first row of a game", () => {
    const before = [row(3, 2), row(2, 1), row(1, 2), row(2, 9)];
    const after = [row(8, 1), row(7, 1)];
    expect(rankChanges(before, after).map((c) => [c.game_id, c.status, c.before?.rank ?? null])).toEqual([
      [7, "entered", null],
      [8, "entered", null],
      [2, "left", 1],
      [1, "left", 2],
      [3, "left", 2],
    ]);
  });

  test("takes iterables and returns nothing for empty snapshots", () => {
    expect(rankChanges([], [])).toEqual([]);
    const after = new Set([row(1, 1)]);
    expect(rankChanges(after.values(), after)).toMatchObject([{ status: "same" }]);
  });
});
