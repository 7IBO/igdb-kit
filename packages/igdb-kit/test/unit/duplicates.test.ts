import { describe, expect, test } from "bun:test";
import { type DuplicateInput, duplicateCandidates, duplicateFields } from "../../src/game";
import { GameType } from "../../src/generated/schema";

const y = (year: number) => Date.UTC(year, 5, 1) / 1000;

function game(id: number, name: string, more: Partial<DuplicateInput> = {}) {
  return {
    id,
    name,
    game_type: GameType.MainGame,
    version_parent: undefined,
    parent_game: undefined,
    first_release_date: undefined,
    platforms: undefined,
    ...more,
  } as DuplicateInput & { id: number };
}

const ids = (pairs: { games: [{ id: number }, { id: number }] }[]) =>
  pairs.map((p) => p.games.map((g) => g.id));

describe("duplicateCandidates()", () => {
  test("pairs two games with the same name, year, platform and developer", () => {
    const dev = [{ company: 7, developer: true }];
    const pairs = duplicateCandidates([
      game(20, "HADES™", { first_release_date: y(2020), platforms: [6], involved_companies: dev }),
      game(10, "Hades", { first_release_date: y(2020), platforms: [6, 130], involved_companies: dev }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(ids(pairs)).toEqual([[10, 20]]);
    expect(pairs[0]?.score).toBe(0.95);
    expect(pairs[0]?.reasons).toEqual(["name", "year", "platforms", "developer"]);
    expect(pairs[0]?.conflicts).toEqual([]);
  });

  test("a name alone stays under the default threshold", () => {
    const games = [game(1, "Snake"), game(2, "Snake")];
    expect(duplicateCandidates(games)).toEqual([]);
    expect(duplicateCandidates(games, { minScore: 0.5 })[0]?.score).toBe(0.5);
  });

  test("years far apart and other developers lower the score: Doom 1993 and Doom 2016", () => {
    const pairs = duplicateCandidates(
      [
        game(1, "Doom", {
          first_release_date: y(1993),
          platforms: [6],
          involved_companies: [{ company: 1, developer: true }],
        }),
        game(2, "DOOM", {
          first_release_date: y(2016),
          platforms: [6],
          involved_companies: [{ company: 1, developer: true }],
        }),
      ],
      { minScore: 0 },
    );
    expect(pairs[0]?.conflicts).toEqual(["year"]);
    expect(pairs[0]?.score).toBe(0.375);
    const other = duplicateCandidates(
      [
        game(1, "Run", {
          first_release_date: y(2020),
          involved_companies: [{ company: 1, developer: true }],
        }),
        game(2, "Run", {
          first_release_date: y(2020),
          involved_companies: [{ company: 2, developer: true }],
        }),
      ],
      { minScore: 0 },
    );
    expect(other[0]?.conflicts).toEqual(["developer"]);
    expect(other[0]?.score).toBe(0.49);
  });

  test("finds a pair by edition label, alternative name or a shared store id", () => {
    const pairs = duplicateCandidates(
      [
        game(1, "NieR:Automata - Game of the Year Edition (PS4)", { first_release_date: y(2017) }),
        game(2, "NieR:Automata", { first_release_date: y(2017) }),
        game(3, "Pokémon Sword", { first_release_date: y(2019) }),
        game(4, "Pokemon Epee", {
          first_release_date: y(2019),
          alternative_names: [{ name: "Pokémon Sword" }],
        }),
        game(5, "Cool Game", { websites: [{ url: "https://store.steampowered.com/app/42/Cool/" }] }),
        game(6, "Kuuru Geemu", {
          external_games: [{ external_game_source: 1, uid: "42" }],
        }),
      ],
      { minScore: 0.5 },
    );
    const byPair = Object.fromEntries(pairs.map((p) => [p.games.map((g) => g.id).join("-"), p]));
    expect(byPair["1-2"]?.reasons).toEqual(["name_without_edition", "year"]);
    expect(byPair["3-4"]?.reasons).toEqual(["alternative_name", "year"]);
    expect(byPair["5-6"]?.reasons).toEqual(["store_id"]);
    expect(byPair["5-6"]?.score).toBe(0.6);
  });

  test("a store id adds to a shared name", () => {
    const steam = [{ url: "store.steampowered.com/app/99" }];
    const pairs = duplicateCandidates([
      game(1, "Tunic", { websites: steam }),
      game(2, "TUNIC", { websites: steam }),
    ]);
    expect(pairs[0]?.reasons).toEqual(["name", "store_id"]);
    expect(pairs[0]?.score).toBe(0.8);
  });

  test("leaves out editions, content, remakes next to their original and linked games", () => {
    const at = { first_release_date: y(2019), platforms: [6] };
    const pairs = duplicateCandidates(
      [
        game(1, "Resident Evil 2", at),
        game(2, "Resident Evil 2", { ...at, game_type: GameType.Remake }),
        game(3, "Resident Evil 2", { ...at, version_parent: 1 }),
        game(4, "Resident Evil 2", { ...at, game_type: GameType.DLC }),
        game(5, "Resident Evil 2", { ...at, game_type: GameType.Bundle }),
        game(6, "Resident Evil 2", { ...at, game_type: GameType.Port, parent_game: { id: 1 } }),
        game(7, "Resident Evil 2", { ...at, ports: [8] }),
        game(8, "Resident Evil 2", { ...at, game_type: GameType.Port }),
      ],
      { minScore: 0 },
    );
    // 1 with 7 and 8 (an unlinked port and an unlinked game), never 2 to 6, never 7 with 8.
    expect(ids(pairs).sort()).toEqual([
      [1, 7],
      [1, 8],
    ]);
  });

  test("a name three games share counts less", () => {
    const at = { first_release_date: y(2023), platforms: [6] };
    const two = duplicateCandidates([game(1, "Abyss", at), game(2, "Abyss", at)]);
    expect(two[0]?.score).toBe(0.8);
    const three = duplicateCandidates([game(1, "Abyss", at), game(2, "Abyss", at), game(3, "Abyss", at)]);
    expect(three.map((p) => p.score)).toEqual([0.7, 0.7, 0.7]);
    expect(three[0]?.conflicts).toEqual(["common_name"]);
  });

  test("a year apart adds little", () => {
    const pairs = duplicateCandidates(
      [game(1, "Mire", { first_release_date: y(2021) }), game(2, "Mire", { first_release_date: y(2022) })],
      { minScore: 0 },
    );
    expect(pairs[0]?.score).toBe(0.55);
  });

  test("remakes of one game on other platforms, or of different games, do not pair up", () => {
    const remake = (id: number, parent: number, platforms: number[]) =>
      game(id, "Tetris", {
        game_type: GameType.Remake,
        parent_game: parent,
        platforms,
        first_release_date: y(1989),
      });
    expect(duplicateCandidates([remake(1, 9, [18]), remake(2, 9, [33])], { minScore: 0 })).toEqual([]);
    expect(duplicateCandidates([remake(1, 9, [18]), remake(2, 8, [18])], { minScore: 0 })).toEqual([]);
    expect(ids(duplicateCandidates([remake(1, 9, [18]), remake(2, 9, [18])]))).toEqual([[1, 2]]);
  });

  test("two remakes of one game pair up", () => {
    const at = { game_type: GameType.Remake, first_release_date: y(2023) };
    expect(ids(duplicateCandidates([game(1, "Dead Space", at), game(2, "Dead Space", at)]))).toEqual([
      [1, 2],
    ]);
  });

  test("skips groups larger than maxGroup, and throws for bad options", () => {
    const many = Array.from({ length: 4 }, (_, i) => game(i + 1, "Tetris", { first_release_date: y(1990) }));
    expect(duplicateCandidates(many, { minScore: 0 })).toHaveLength(6);
    expect(duplicateCandidates(many, { minScore: 0, maxGroup: 3 })).toEqual([]);
    expect(() => duplicateCandidates(many, { minScore: 2 })).toThrow(TypeError);
    expect(() => duplicateCandidates(many, { maxGroup: 1 })).toThrow(TypeError);
  });

  test("reports each pair once, even when it shares several keys", () => {
    const steam = [{ url: "https://store.steampowered.com/app/1/" }];
    const a = game(1, "Celeste", { alternative_names: [{ name: "Celeste" }], websites: steam });
    const b = game(2, "Celeste", { websites: steam });
    expect(duplicateCandidates([a, b])).toHaveLength(1);
  });

  test("lists its fields", () => {
    expect(duplicateFields()).toContain("websites.url");
    expect(duplicateFields()).toHaveLength(15);
  });
});
