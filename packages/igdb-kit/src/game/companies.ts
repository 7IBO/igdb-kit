import type { Company } from "../generated/schema";
import type { Selection } from "../links/selection";
import type { FieldPath } from "../query/types";
import { type ItemOf, idOf, type Ref, type Requires } from "./select";

/** Fields of `involved_companies` that {@link companies} reads. */
export type CompanyFields =
  | "involved_companies.company"
  | "involved_companies.developer"
  | "involved_companies.publisher"
  | "involved_companies.porting"
  | "involved_companies.supporting";

/**
 * The fields {@link companies} reads, to spread into `select()`: the role flags and the companies
 * as ids, or with the fields you name (`companyFields("name")` selects
 * `involved_companies.company.name`).
 */
export function companyFields(): Selection<"games", CompanyFields>;
export function companyFields<F extends string>(
  field: FieldPath<Company, F>,
  ...more: FieldPath<Company, F>[]
): Selection<
  "games",
  Exclude<CompanyFields, "involved_companies.company"> | `involved_companies.company.${F}`
>;
export function companyFields(...fields: string[]): readonly string[] {
  const company =
    fields.length === 0
      ? ["involved_companies.company"]
      : fields.map((field) => `involved_companies.company.${field}`);
  return Object.freeze([
    ...company,
    "involved_companies.developer",
    "involved_companies.publisher",
    "involved_companies.porting",
    "involved_companies.supporting",
  ]);
}

interface InvolvedCompanyRow {
  company?: Ref | undefined;
  developer?: boolean | undefined;
  publisher?: boolean | undefined;
  porting?: boolean | undefined;
  supporting?: boolean | undefined;
}

/** A game whose selection lets {@link companies} work. */
export interface CompaniesInput {
  involved_companies?: readonly InvolvedCompanyRow[] | undefined;
}

type CompanyOf<G> = NonNullable<ItemOf<G, "involved_companies"> extends { company?: infer C } ? C : never>;

export interface GameCompanies<C> {
  developers: C[];
  /** Often several: one per region (WB Games, Bandai Namco, Spike Chunsoft... for The Witcher 3). */
  publishers: C[];
  /** Studios that ported the game to other platforms. */
  porting: C[];
  /** Studios that helped with development. */
  supporting: C[];
}

/**
 * The companies of a game by role, each company once per role, in IGDB's order. A company can hold
 * several roles (developer and publisher), sometimes split across two `involved_companies` rows.
 * Empty lists mean IGDB lists none, which is the case for about half of all games.
 *
 * ```ts
 * const game = await igdb.games.select("involved_companies.company.name", "involved_companies.developer",
 *   "involved_companies.publisher", "involved_companies.porting", "involved_companies.supporting").findByIdOrThrow(1942);
 * companies(game).developers.map((c) => c.name); // ["CD Projekt RED"]
 * ```
 */
export function companies<G extends object>(
  game: G & Requires<G, CompanyFields>,
): GameCompanies<CompanyOf<G>> {
  const result: GameCompanies<Ref> = { developers: [], publishers: [], porting: [], supporting: [] };
  const seen = { developers: new Set(), publishers: new Set(), porting: new Set(), supporting: new Set() };
  const add = (role: keyof GameCompanies<Ref>, company: Ref) => {
    const id = idOf(company);
    if (seen[role].has(id)) return;
    seen[role].add(id);
    result[role].push(company);
  };
  for (const row of (game as CompaniesInput).involved_companies ?? []) {
    // A company deleted from IGDB disappears from an expanded relation, leaving no `company`.
    if (row.company === undefined) continue;
    if (row.developer) add("developers", row.company);
    if (row.publisher) add("publishers", row.company);
    if (row.porting) add("porting", row.company);
    if (row.supporting) add("supporting", row.company);
  }
  return result as GameCompanies<CompanyOf<G>>;
}
