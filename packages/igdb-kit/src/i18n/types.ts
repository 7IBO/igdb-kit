import type { Locale } from "../game/locale";
import type {
  AgeRatingContentDescriptionType,
  AgeRatingContentDescriptionV2,
  ArtworkType,
  CharacterGender,
  CharacterSpecie,
  CollectionMembershipType,
  CollectionRelationType,
  CollectionType,
  CompanySize,
  CompanyStatus,
  CompanyType,
  GameMode,
  GameReleaseFormat,
  GameStatus,
  GameType,
  Genre,
  ImageType,
  LanguageSupportType,
  NetworkType,
  PlatformType,
  PlayerPerspective,
  PopularityType,
  Region,
  ReleaseDateRegion,
  ReleaseDateStatus,
  Theme,
  WebsiteType,
} from "../generated/schema";

type Ids<E> = E[keyof E];

/** The ids each table with labels takes, by IGDB endpoint name. */
export interface LabelIds {
  genres: Ids<typeof Genre>;
  themes: Ids<typeof Theme>;
  game_modes: Ids<typeof GameMode>;
  player_perspectives: Ids<typeof PlayerPerspective>;
  game_types: Ids<typeof GameType>;
  game_statuses: Ids<typeof GameStatus>;
  game_release_formats: Ids<typeof GameReleaseFormat>;
  platform_types: Ids<typeof PlatformType>;
  release_date_statuses: Ids<typeof ReleaseDateStatus>;
  release_date_regions: Ids<typeof ReleaseDateRegion>;
  regions: Ids<typeof Region>;
  website_types: Ids<typeof WebsiteType>;
  language_support_types: Ids<typeof LanguageSupportType>;
  popularity_types: Ids<typeof PopularityType>;
  character_genders: Ids<typeof CharacterGender>;
  character_species: Ids<typeof CharacterSpecie>;
  company_statuses: Ids<typeof CompanyStatus>;
  company_sizes: Ids<typeof CompanySize>;
  company_types: Ids<typeof CompanyType>;
  network_types: Ids<typeof NetworkType>;
  collection_types: Ids<typeof CollectionType>;
  collection_membership_types: Ids<typeof CollectionMembershipType>;
  collection_relation_types: Ids<typeof CollectionRelationType>;
  image_types: Ids<typeof ImageType>;
  artwork_types: Ids<typeof ArtworkType>;
  /** Content and interactive element types of the descriptors. */
  age_rating_content_description_types: Ids<typeof AgeRatingContentDescriptionType>;
  /** The 97 descriptors of the ESRB, PEGI, CERO, GRAC and ClassInd ("Blood and Gore", "Fear"). */
  age_rating_content_descriptions_v2: Ids<typeof AgeRatingContentDescriptionV2>;
}

/** A table {@link createLabels} has labels for. */
export type LabelTable = keyof LabelIds;

/** A table {@link createLabels} also has descriptions for. */
export type DescribedTable =
  | "release_date_statuses"
  | "collection_types"
  | "collection_membership_types"
  | "collection_relation_types";

type Texts<T extends LabelTable> = { readonly [Id in LabelIds[T]]?: string };

/**
 * The ids every table of `T` has a label for: `LabelIds[T]` for one table, the ids they share for
 * several. English has a label for each, so `label()` of such an id is never null.
 */
type KnownId<T extends LabelTable> = (T extends LabelTable ? (id: LabelIds[T]) => void : never) extends (
  id: infer Id extends number,
) => void
  ? Id
  : never;

/** What `label()` and `description()` take: an id, or a row of a query with any selection. */
type LabelInput = number | LabelRow | null | undefined;

/**
 * The labels of one language. igdb-kit has `en` built in and one entry point per language
 * (`igdb-kit/i18n/fr`); write your own for another language, or to change some labels: a table
 * or an id it leaves out falls back to the next dictionary, then to English.
 */
export interface LabelDictionary {
  /** BCP 47 tag of the language: `"fr"`, `"pt-BR"`, `"zh-CN"`. */
  locale: Locale;
  labels: { readonly [T in LabelTable]?: Texts<T> };
  descriptions?: { readonly [T in DescribedTable]?: Texts<T> } | undefined;
}

/** A row as IGDB returns it: its `id` and, for an id this version has no label for, its own label. */
export interface LabelRow {
  id?: number | undefined;
  name?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  format?: string | undefined;
  region?: string | undefined;
  description?: string | undefined;
}

/** One option of {@link Labels.entries}: an id of the table and its label. */
export interface LabelEntry<Id extends number = number> {
  id: Id;
  label: string;
}

export interface Labels {
  /**
   * The label of a row in the user's language, from its id or from the row itself:
   * `label("genres", 12, "fr-FR")` is "Jeu de rôle (RPG)". English when no dictionary has it, the
   * row's own label for an id added to IGDB after this version, null for an unknown id without one.
   * A known id, such as `Genre.RolePlayingRPG`, always has a label: the result is then a `string`.
   */
  label<T extends LabelTable>(table: T, row: KnownId<T>, locale: Locale): string;
  label<T extends LabelTable>(table: T, row: LabelInput, locale: Locale): string | null;
  /** The description of a release status or collection type, as {@link Labels.label} does labels. */
  description<T extends DescribedTable>(table: T, row: KnownId<T>, locale: Locale): string;
  description<T extends DescribedTable>(table: T, row: LabelInput, locale: Locale): string | null;
  /** Every id of a table with its label, in IGDB's id order: the options of a filter. */
  entries<T extends LabelTable>(table: T, locale: Locale): LabelEntry<LabelIds[T]>[];
}
