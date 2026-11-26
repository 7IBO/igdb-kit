import { describe, expect, test } from "bun:test";
import { ratingFields, ratingOf } from "../../src/game";

const game = {
  id: 1,
  total_rating: 100,
  total_rating_count: 1,
  aggregated_rating: 88.5,
  aggregated_rating_count: 2,
  rating: 91.25,
  rating_count: 40,
};

describe("ratingOf()", () => {
  test("takes the total rating by default, from one vote, not rounded", () => {
    expect(ratingOf(game)).toEqual({ value: 100, count: 1, source: "total" });
    expect(ratingOf(game, { minCount: 5 })).toBeNull();
  });

  test("falls back along prefer, with a threshold per source", () => {
    const options = { prefer: ["critics", "users"] as const, minCount: { critics: 3, users: 20 } };
    expect(ratingOf(game, options)).toEqual({ value: 91.25, count: 40, source: "users" });
    expect(ratingOf(game, { prefer: ["critics", "users"] })?.source).toBe("critics");
    expect(ratingOf(game, { prefer: ["users"], minCount: { users: 41 } })).toBeNull();
  });

  test("is null for a missing value or count, or a count of 0", () => {
    expect(ratingOf({ id: 2, total_rating: 70, total_rating_count: 0 })).toBeNull();
    expect(ratingOf({ id: 2, total_rating: undefined, total_rating_count: 9 })).toBeNull();
    expect(ratingOf({ id: 2, total_rating: 70, total_rating_count: undefined })).toBeNull();
    expect(ratingOf({ id: 2, total_rating: 70, total_rating_count: 3 }, { minCount: 0 })?.count).toBe(3);
  });

  test("lists the fields of the sources asked, all three by default", () => {
    expect(ratingFields("critics")).toEqual(["aggregated_rating", "aggregated_rating_count"]);
    expect(ratingFields()).toHaveLength(6);
    expect(ratingFields("total", "total")).toHaveLength(2);
  });

  test("throws for a minCount that is not a finite number", () => {
    const game = { id: 2, total_rating: 70, total_rating_count: 3 };
    expect(() => ratingOf(game, { minCount: Number.NaN })).toThrow(TypeError);
    expect(() => ratingOf(game, { minCount: { total: Number.POSITIVE_INFINITY } })).toThrow(TypeError);
  });
});
