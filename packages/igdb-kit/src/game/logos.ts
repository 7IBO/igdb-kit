import { ImageType } from "../generated/schema";
import { imageTypeOf } from "../images";
import type { Selection } from "../links/selection";
import { positive, type Requires } from "./select";

// IGDB moved logos out of `artworks` into `logos`, typed by `image_type`, and stops serving the logo
// types of `artwork_type` at the end of 2026. A game does not list its logos: read them by game.

/** Fields of `logos` that {@link bestLogo} reads. */
export type LogoFields = "image_id" | "image_type" | "width" | "height";

/**
 * The fields {@link bestLogo} reads, for `igdb.logos`:
 * `igdb.logos.select(...logoFields()).findByGames(ids)`.
 */
export function logoFields(): Selection<"logos", LogoFields> {
  return Object.freeze(["image_id", "image_type", "width", "height"] as const);
}

/** The fields each row passed to {@link bestLogo} must have selected. */
export type BestLogoRequires<R> = Requires<R, "image_id" | "image_type">;

interface LogoRow {
  image_id?: string | undefined;
  image_type?: number | { id: number } | undefined;
  artwork_type?: number | { id: number } | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface BestLogo {
  /** For `imageUrl()`: `imageUrl(logo.image_id, "logo_med", { format: "png" })` keeps transparency. */
  image_id: string;
  /** `ImageType` id: `GameLogoColor`, `GameLogoWhite`, `GameLogoBlack` or `HistoricalLogo`. */
  type: number;
  /** Of the original image, when selected. */
  width: number | null;
  height: number | null;
  /** `width / height`, null when unknown. */
  ratio: number | null;
}

export interface BestLogoOptions {
  /**
   * What the logo is drawn on. `"dark"`: the white logo, else the color one. `"light"`: the black
   * logo, else the color one. Default: the color logo, then white, then black.
   */
  on?: "dark" | "light" | undefined;
  /**
   * Also pick a historical logo when the game has no current one. IGDB does not say a historical
   * logo's colors, so the default is `true` without `on` and `false` with it.
   */
  includeHistorical?: boolean | undefined;
}

const ORDER: Record<"dark" | "light" | "any", readonly number[]> = {
  dark: [ImageType.GameLogoWhite, ImageType.GameLogoColor],
  light: [ImageType.GameLogoBlack, ImageType.GameLogoColor],
  any: [ImageType.GameLogoColor, ImageType.GameLogoWhite, ImageType.GameLogoBlack],
};

/**
 * The logo to show for a game, from its rows of `logos` (see {@link logoFields}). Artworks work too,
 * so data read before IGDB moved logos out of `artworks` still gives one. Null when none fits: with
 * `on`, a white logo is never drawn on a light background, nor a black one on a dark background.
 *
 * ```ts
 * const logos = await igdb.logos.select(...logoFields()).findByGames([1942]);
 * const logo = bestLogo(logos.get(1942) ?? [], { on: "dark" });
 * imageUrl(logo?.image_id, "logo_med", { format: "png" });
 * ```
 */
export function bestLogo<R extends object>(
  rows: readonly (R & BestLogoRequires<R>)[],
  options: BestLogoOptions = {},
): BestLogo | null {
  const order = ORDER[options.on ?? "any"];
  const historical = options.includeHistorical ?? options.on === undefined;
  const types = historical ? [...order, ImageType.HistoricalLogo] : order;
  let found: { row: LogoRow; type: number } | undefined;
  for (const row of rows as readonly LogoRow[]) {
    const type = imageTypeOf(row);
    if (!row.image_id || type === null || !types.includes(type)) continue;
    if (!found || types.indexOf(type) < types.indexOf(found.type)) found = { row, type };
  }
  if (!found) return null;
  const width = positive(found.row.width) ?? null;
  const height = positive(found.row.height) ?? null;
  return {
    image_id: found.row.image_id as string,
    type: found.type,
    width,
    height,
    ratio: width !== null && height !== null ? width / height : null,
  };
}
