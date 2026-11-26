import { ImageType } from "../generated/schema";
import { imageTypeOf } from "../images";
import type { Selection } from "../links/selection";
import type { BestImage } from "./images";
import { positive } from "./select";

// IGDB moved covers and logos out of `artworks` into `covers` and `logos`, typed by `image_type`,
// and stops serving the cover and logo types of `artwork_type` at the end of 2026. A game lists
// neither its logos nor its covers other than `cover`: read them by game.

type ImageFields = "image_id" | "image_type" | "width" | "height";

/**
 * The fields the `covers` option of `bestImage()` reads, for `igdb.covers`:
 * `igdb.covers.select(...coverFields()).findByGames(ids)`.
 */
export function coverFields(): Selection<"covers", ImageFields> {
  return Object.freeze(["image_id", "image_type", "width", "height"] as const);
}

/**
 * The fields {@link bestLogo} reads, for `igdb.logos`:
 * `igdb.logos.select(...logoFields()).findByGames(ids)`.
 */
export function logoFields(): Selection<"logos", ImageFields> {
  return Object.freeze(["image_id", "image_type", "width", "height"] as const);
}

interface LogoRow {
  image_id?: string | undefined;
  image_type?: number | { id: number } | undefined;
  artwork_type?: number | { id: number } | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface BestLogoOptions {
  /**
   * What the logo is drawn on. `"dark"`: the white logo, else the color one. `"light"`: the black
   * logo, else the color one. Default: the color logo, then white, then black.
   */
  on?: "dark" | "light" | undefined;
  /** Also pick a historical logo when the game has no current one. Default `true`. */
  historical?: boolean | undefined;
}

const ORDER: Record<"dark" | "light" | "any", readonly number[]> = {
  dark: [ImageType.GameLogoWhite, ImageType.GameLogoColor],
  light: [ImageType.GameLogoBlack, ImageType.GameLogoColor],
  any: [ImageType.GameLogoColor, ImageType.GameLogoWhite, ImageType.GameLogoBlack],
};

/**
 * The logo to show for a game, from its rows of `logos` (see {@link logoFields}). Artworks work too,
 * so data read before IGDB moved logos out of `artworks` still gives one. Null when none fits: a
 * white logo is never drawn on a light background, nor a black one on a dark background.
 *
 * ```ts
 * const logos = await igdb.logos.select(...logoFields()).findByGames([1942]);
 * const logo = bestLogo(logos.get(1942) ?? [], { on: "dark" });
 * imageUrl(logo?.image_id, "logo_med", { format: "png" });
 * ```
 */
export function bestLogo<R extends LogoRow>(
  rows: readonly R[],
  options: BestLogoOptions = {},
): BestImage | null {
  const order = ORDER[options.on ?? "any"];
  const types = options.historical === false ? order : [...order, ImageType.HistoricalLogo];
  const logos = rows
    .filter((row) => row.image_id)
    .map((row) => ({ row, type: imageTypeOf(row) }))
    .filter((logo) => logo.type !== null && types.includes(logo.type));
  logos.sort((a, b) => types.indexOf(a.type as number) - types.indexOf(b.type as number));
  const found = logos[0];
  if (!found) return null;
  const width = positive(found.row.width) ?? null;
  const height = positive(found.row.height) ?? null;
  return {
    image_id: found.row.image_id as string,
    source: "logo",
    type: found.type,
    width,
    height,
    ratio: width !== null && height !== null ? width / height : null,
  };
}
