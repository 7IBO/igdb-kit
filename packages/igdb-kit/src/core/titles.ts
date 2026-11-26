// How titles are compared: by `games.match()` and `duplicateCandidates()`.

/** Without trademark signs and repeated spaces: "DARK SOULS™ III" -> "DARK SOULS III". */
export function clean(title: string): string {
  return title
    .replace(/[™®©℠]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EDITION_WORDS =
  "game of the year|goty|digital deluxe|deluxe|complete|definitive|ultimate|gold|premium|standard|special|collector'?s|launch|day one|day 1|enhanced|anniversary|legendary";

/** Trailing edition and platform labels, after a separator or not: " - GOTY Edition", "(PS5)". */
const SUFFIXES = [
  /\s*[([][^)\]]*[)\]]\s*$/,
  new RegExp(`\\s*[-–—:,]?\\s*\\b(?:the\\s+)?(?:(?:${EDITION_WORDS})\\s+)+(?:edition|version)\\s*$`, "i"),
  /\s*[-–—:,]?\s*\b(?:goty|director'?s cut)\s*$/i,
  /\s*[-–—:,]?\s*\b(?:PS4|PS5|PS4\s*(?:&|and|\/)\s*PS5|Xbox One|Xbox Series X\|S|Nintendo Switch)(?:\s+edition)?\s*$/i,
];

/** The title without its trailing edition and platform labels, or the title when that leaves nothing. */
export function withoutEdition(title: string): string {
  let base = title;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const next = base.replace(suffix, "");
      if (next !== base && next.trim() !== "") {
        base = next.trim();
        changed = true;
      }
    }
  }
  return base;
}

/** Roman numerals of sequels, as words: "Final Fantasy VII" is "final fantasy 7". "I" and "X" stay. */
const ROMAN: Record<string, string> = Object.fromEntries(
  ["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"]
    .map((numeral, i) => [numeral, String(i + 2)])
    .concat(["xi", "xii", "xiii", "xiv", "xv", "xvi"].map((numeral, i) => [numeral, String(i + 11)])),
);

/**
 * The form titles are compared in: lower case, without accents, trademark signs, apostrophes or
 * punctuation, with sequel numerals as digits and "GOTY" spelled out. Kana keep their voicing
 * marks: ガ is not カ.
 */
export function titleKey(title: string): string {
  return title
    .replace(/[™®©℠]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC") // puts back the kana voicing marks (ｶﾞ is ガ) and the hangul syllables
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => ROMAN[word] ?? (word === "goty" ? "game of the year" : word))
    .join(" ");
}
