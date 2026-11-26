import { describe, expect, test } from "bun:test";
import { ImageType } from "../../src";
import { bestImage, bestLogo } from "../../src/game";

// IGDB moved covers and logos out of artworks into their own endpoints, typed by image_type.
describe("bestLogo", () => {
  const logo = (image_id: string, image_type: number | undefined, width = 400, height = 100) => ({
    id: 1,
    image_id,
    image_type,
    width,
    height,
  });

  test("picks the color logo by default, then the white, then the black", () => {
    const rows = [logo("black", ImageType.GameLogoBlack), logo("white", ImageType.GameLogoWhite)];
    expect(bestLogo(rows)?.image_id).toBe("white");
    expect(bestLogo([...rows, logo("color", ImageType.GameLogoColor)])).toEqual({
      image_id: "color",
      source: "logo",
      type: ImageType.GameLogoColor,
      width: 400,
      height: 100,
      ratio: 4,
    });
  });

  test("never draws a white logo on light, nor a black one on dark", () => {
    expect(bestLogo([logo("white", ImageType.GameLogoWhite)], { on: "light" })).toBeNull();
    expect(bestLogo([logo("black", ImageType.GameLogoBlack)], { on: "dark" })).toBeNull();
    const rows = [logo("black", ImageType.GameLogoBlack), logo("white", ImageType.GameLogoWhite)];
    expect(bestLogo(rows, { on: "dark" })?.image_id).toBe("white");
    expect(bestLogo(rows, { on: "light" })?.image_id).toBe("black");
  });

  test("falls back to a historical logo unless told not to", () => {
    const rows = [logo("old", ImageType.HistoricalLogo)];
    expect(bestLogo(rows)?.image_id).toBe("old");
    expect(bestLogo(rows, { historical: false })).toBeNull();
    expect(bestLogo([...rows, logo("now", ImageType.GameLogoColor)])?.image_id).toBe("now");
  });

  test("reads artworks typed by artwork_type, which numbers logos the same", () => {
    const artwork = { id: 2, image_id: "legacy", image_type: undefined, artwork_type: 7 };
    expect(bestLogo([artwork])).toMatchObject({ image_id: "legacy", type: ImageType.GameLogoColor });
  });

  test("leaves out key art, untyped rows and rows without an image", () => {
    expect(bestLogo([logo("art", ImageType.KeyArtWithLogo), logo("none", undefined)])).toBeNull();
    expect(bestLogo([{ id: 3, image_type: ImageType.GameLogoColor }])).toBeNull();
    expect(bestLogo([])).toBeNull();
  });
});

describe("bestImage with the covers of a game", () => {
  const cover = (image_id: string, image_type: number | undefined) => ({
    id: 1,
    image_id,
    image_type,
    width: 600,
    height: 800,
  });
  const covers = [cover("square", ImageType.SquareCover), cover("alt", ImageType.AlternativeCover)];

  test("game.cover first, then the other covers in their order, before artworks", () => {
    const artworks = [
      { id: 5, image_id: "art", image_type: ImageType.KeyArtWithLogo, artwork_type: undefined },
    ];
    const game = { id: 1, cover: { id: 9, image_id: "main" }, artworks };
    expect(bestImage(game, { covers })?.image_id).toBe("main");
    const { cover: _, ...noCover } = game;
    expect(bestImage(noCover, { covers })).toEqual({
      image_id: "alt",
      source: "cover",
      type: ImageType.AlternativeCover,
      width: 600,
      height: 800,
      ratio: 0.75,
    });
    expect(bestImage(noCover)?.image_id).toBe("art");
  });

  test("a cover IGDB has not typed still counts, after the typed ones", () => {
    const game = { id: 1, cover: undefined };
    expect(bestImage(game, { covers: [cover("plain", undefined)] })).toMatchObject({
      image_id: "plain",
      type: null,
    });
    expect(
      bestImage(game, { covers: [cover("plain", undefined), cover("hist", ImageType.HistoricalCover)] })
        ?.image_id,
    ).toBe("hist");
  });

  test("a background comes from the covers only when nothing wider is there", () => {
    const game = { id: 1, cover: undefined, screenshots: [{ id: 4, image_id: "shot" }] };
    expect(bestImage(game, { prefer: "background", covers })?.image_id).toBe("shot");
    expect(bestImage({ id: 1, cover: undefined }, { prefer: "background", covers })?.image_id).toBe("alt");
  });
});
