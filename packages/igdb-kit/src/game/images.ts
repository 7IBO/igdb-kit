import { entities, ImageType } from "../generated/schema";
import { type ArtworkTypeFields, imageTypeOf } from "../images";
import type { Selection } from "../links/selection";
import { positive, type Requires, type RequiresIfSelected } from "./select";

interface ImageRow {
  image_id?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

interface ArtworkRow extends ImageRow {
  image_type?: number | { id: number } | undefined;
  artwork_type?: number | { id: number } | undefined;
}

/** A game whose selection lets {@link bestImage} work. */
export interface BestImageInput {
  cover?: ImageRow | undefined;
  artworks?: readonly ArtworkRow[] | undefined;
  screenshots?: readonly ImageRow[] | undefined;
}

/**
 * `cover.image_id`, `artworks.image_id` with the artwork's type, `screenshots.image_id`: each image
 * kind selected needs these fields, and at least one kind must be selected. `width` and `height`
 * give the ratio when selected.
 */
export type BestImageRequires<G> = RequiresIfSelected<G, "cover", "cover.image_id"> &
  RequiresIfSelected<G, "artworks", "artworks.image_id" | `artworks.${ArtworkTypeFields}`> &
  RequiresIfSelected<G, "screenshots", "screenshots.image_id"> &
  ("cover" extends keyof G
    ? unknown
    : "artworks" extends keyof G
      ? unknown
      : "screenshots" extends keyof G
        ? unknown
        : Requires<G, "cover.image_id">);

type ImageFields = "image_id" | "width" | "height";

export type BestImageFields = Selection<
  "games",
  `cover.${ImageFields}` | `artworks.${ImageFields | ArtworkTypeFields}` | `screenshots.${ImageFields}`
>;

// IGDB announced the end of `artwork_type`: the list drops it once the schema no longer has it.
const hasArtworkType = "artwork_type" in (entities.Artwork ?? {});

/**
 * The fields {@link bestImage} reads, to spread into `select()`: the cover, the artworks with their
 * type and the screenshots, each with its size.
 */
export function bestImageFields(): BestImageFields {
  return Object.freeze([
    "cover.image_id",
    "cover.width",
    "cover.height",
    "artworks.image_id",
    "artworks.image_type",
    ...(hasArtworkType ? ["artworks.artwork_type"] : []),
    "artworks.width",
    "artworks.height",
    "screenshots.image_id",
    "screenshots.width",
    "screenshots.height",
  ] as const) as BestImageFields;
}

export interface BestImage {
  /** For `imageUrl()` and `imageSrcSet()`. */
  image_id: string;
  /** `"cover"` for `game.cover` and the rows of the `covers` option. */
  source: "cover" | "artwork" | "screenshot";
  /**
   * `ImageType` id of an artwork or a row of the `covers` option, from `artworkType()`; null for a
   * screenshot, `game.cover` and a cover IGDB has not typed.
   */
  type: number | null;
  /** Of the original image, when selected. */
  width: number | null;
  height: number | null;
  /** `width / height`: 0.75 for most covers, 1.78 for screenshots; null when unknown. */
  ratio: number | null;
}

export interface BestImageOptions<C extends object = CoverRow> {
  /**
   * `"cover"` (default): the box art, else an artwork that is a cover, then key art or another
   * artwork, then a screenshot. `"background"`: a landscape artwork (key art without logo first),
   * then a screenshot, then the cover. Logos, icons and infographics are never picked.
   */
  prefer?: "cover" | "background" | undefined;
  /**
   * The game's other covers, read from `covers` by game (see {@link coverFields}): `game.cover` is
   * only the main one, and IGDB moves alternative, square and historical covers out of `artworks`
   * at the end of 2026. Without a main cover, these come before the artworks.
   */
  covers?: readonly (C & Requires<C, "image_id" | "image_type">)[] | undefined;
}

interface CoverRow extends ImageRow {
  image_type?: number | { id: number } | undefined;
}

/** Fields of `covers` that the `covers` option of {@link bestImage} reads. */
export type CoverFields = "image_id" | "image_type" | "width" | "height";

/**
 * The fields the `covers` option of {@link bestImage} reads, for `igdb.covers`:
 * `igdb.covers.select(...coverFields()).findByGames(ids)`.
 */
export function coverFields(): Selection<"covers", CoverFields> {
  return Object.freeze(["image_id", "image_type", "width", "height"] as const);
}

// Artwork types, best first, for each use.
const coverTypes: readonly number[] = [
  ImageType.MainCover,
  ImageType.AlternativeCover,
  ImageType.SquareCover,
  ImageType.HistoricalCover,
];
const artTypes: readonly (number | null)[] = [
  ImageType.KeyArtWithoutLogo,
  ImageType.KeyArtWithLogo,
  ImageType.Artwork,
  ImageType.HistoricalArtwork,
  ImageType.ConceptArt,
  null,
];
const backgroundTypes: readonly (number | null)[] = [
  ImageType.KeyArtWithoutLogo,
  ImageType.Artwork,
  ImageType.KeyArtWithLogo,
  ImageType.HistoricalArtwork,
  ImageType.ConceptArt,
  null,
];

/**
 * The image to show for a game, with its size: the cover, else an artwork, else a screenshot.
 * 13% of complete games have no cover; 6,669 of them have an artwork and 15,886 screenshots. With
 * `prefer: "background"`, a wide image for a banner. Null when the game has no image at all.
 *
 * ```ts
 * const game = await igdb.games.select(...bestImageFields()).findByIdOrThrow(119133);
 * const hero = bestImage(game, { prefer: "background" });
 * imageUrl(hero?.image_id, "1080p"); // the 1920x620 artwork of Elden Ring, not one of its logos
 * ```
 */
export function bestImage<G extends object, C extends object = CoverRow>(
  game: G & BestImageRequires<G>,
  options: BestImageOptions<C> = {},
): BestImage | null {
  const input = game as BestImageInput;
  const artworks = typed(input.artworks);
  const covers = typed(options.covers as readonly CoverRow[] | undefined);
  const cover = input.cover?.image_id ? input.cover : undefined;
  const screenshot = input.screenshots?.find((row) => row.image_id);
  const artwork = (types: readonly (number | null)[], landscape: boolean) => pick(artworks, types, landscape);

  if (options.prefer === "background") {
    const wide = artwork(backgroundTypes, true);
    if (wide) return image(wide.row, "artwork", wide.type);
    if (screenshot) return image(screenshot, "screenshot", null);
    if (cover) return image(cover, "cover", null);
    const otherCover = pick(covers, [...coverTypes, null], false);
    if (otherCover) return image(otherCover.row, "cover", otherCover.type);
    const other = artwork([...backgroundTypes, ...coverTypes], false);
    return other ? image(other.row, "artwork", other.type) : null;
  }
  if (cover) return image(cover, "cover", null);
  const otherCover = pick(covers, [...coverTypes, null], false);
  if (otherCover) return image(otherCover.row, "cover", otherCover.type);
  const art = artwork([...coverTypes, ...artTypes], false);
  if (art) return image(art.row, "artwork", art.type);
  return screenshot ? image(screenshot, "screenshot", null) : null;
}

interface Typed<R> {
  row: R;
  type: number | null;
}

function typed<R extends CoverRow>(rows: readonly R[] | undefined): Typed<R>[] {
  return (rows ?? []).filter((row) => row.image_id).map((row) => ({ row, type: imageTypeOf(row) }));
}

/** The first row of the first type of `types` that has one; landscape rows only when asked. */
function pick<R extends ImageRow>(
  rows: readonly Typed<R>[],
  types: readonly (number | null)[],
  landscape: boolean,
): Typed<R> | undefined {
  for (const type of types) {
    const found = rows.find(
      (a) => a.type === type && (!landscape || !((a.row.height ?? 0) > (a.row.width ?? 0))),
    );
    if (found) return found;
  }
  return undefined;
}

function image(row: ImageRow, source: BestImage["source"], type: number | null): BestImage {
  const width = positive(row.width) ?? null;
  const height = positive(row.height) ?? null;
  return {
    image_id: row.image_id as string,
    source,
    type,
    width,
    height,
    ratio: width !== null && height !== null ? width / height : null,
  };
}
