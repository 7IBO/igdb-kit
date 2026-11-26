// Refreshes codegen/docs-fields.json from IGDB's API docs (https://api-docs.igdb.com), so that the
// descriptions and deprecation notices in the generated types follow the docs: the weekly schema
// update runs it before codegen, and its pull request shows what changed.
//
//   bun run docs-fields
//
// The docs are one page: each endpoint is a section whose heading names it, with its address
// (https://api.igdb.com/v4/<path>) and a table of fields (field, type, description). An endpoint the
// page no longer gives keeps its previous entry, and is listed in the pull request. A page that cannot
// be read, or that misses more than MAX_MISSING endpoints (a changed layout, an error page), leaves
// the file as it is and exits with 1, so the run says so instead of erasing the descriptions.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = "https://api-docs.igdb.com/";
const OUT = join(import.meta.dir, "../codegen/docs-fields.json");
/** More endpoints than this missing from the page is a changed layout or an error page. */
const MAX_MISSING = 3;

export interface DocEndpoint {
  name: string;
  path: string;
  /** The id of the section's heading, for links to it. */
  anchor?: string;
  fields: { name: string; type: string; desc: string }[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
};

function entity(m: string, e: string): string {
  const code = /^#x[0-9a-f]+$/i.test(e)
    ? Number.parseInt(e.slice(2), 16)
    : /^#\d+$/.test(e)
      ? Number(e.slice(1))
      : NaN;
  if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
  return ENTITIES[e] ?? m;
}

/** The text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, entity)
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?)])/g, "$1")
    .replace(/\( /g, "(")
    .trim();
}

/**
 * The endpoints of the docs page, in its order. A section counts when it has an address and a table
 * headed field, type, description; a second section with the same address is skipped.
 */
export function parseDocs(html: string): DocEndpoint[] {
  const out: DocEndpoint[] = [];
  const seen = new Set<string>();
  const headings = [...html.matchAll(/<h([12])([^>]*)>([\s\S]*?)<\/h\1>/g)];
  for (const [i, heading] of headings.entries()) {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[i + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const path = section.match(/https:\/\/api\.igdb\.com\/v4\/([a-z0-9_]+)/)?.[1];
    const table = section.match(/<table[\s\S]*?<\/table>/)?.[0];
    if (!path || !table || seen.has(path)) continue;
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) =>
      [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell = ""]) => textOf(cell)),
    );
    const [head = [], ...body] = rows;
    if (head[0]?.toLowerCase() !== "field" || head[1]?.toLowerCase() !== "type") continue;
    const fields = body
      .filter((cells) => cells.length >= 2 && /^[a-z0-9_]+$/.test(cells[0] ?? ""))
      .map(([name = "", type = "", desc = ""]) => ({ name, type, desc }));
    if (!fields.length) continue;
    seen.add(path);
    const anchor = heading[2]?.match(/\bid="([^"]+)"/)?.[1];
    out.push({ name: textOf(heading[3] ?? ""), path, ...(anchor ? { anchor } : {}), fields });
  }
  return out;
}

/** The changes between two versions of the file, for the pull request's body. */
export function changes(before: DocEndpoint[], after: DocEndpoint[]): string[] {
  const lines: string[] = [];
  const old = new Map(before.map((e) => [e.path, e]));
  for (const e of after) {
    const prev = old.get(e.path);
    if (!prev) {
      lines.push(`- New endpoint \`${e.path}\``);
      continue;
    }
    if (prev.name !== e.name) lines.push(`- Endpoint \`${e.path}\` renamed: ${prev.name} to ${e.name}`);
    const fields = new Map(prev.fields.map((f) => [f.name, f]));
    for (const f of e.fields) {
      const p = fields.get(f.name);
      if (!p) lines.push(`- \`${e.path}.${f.name}\` is documented: ${f.desc || "(no description)"}`);
      else if (p.desc !== f.desc || p.type !== f.type)
        lines.push(`- \`${e.path}.${f.name}\`: ${f.type}, ${f.desc || "(no description)"}`);
      fields.delete(f.name);
    }
    for (const name of fields.keys()) lines.push(`- \`${e.path}.${name}\` left the docs`);
    old.delete(e.path);
  }
  for (const path of old.keys())
    lines.push(
      `- Endpoint \`${path}\` left the docs: its previous entry is kept (remove it by hand if IGDB dropped it)`,
    );
  return lines;
}

/**
 * The new file: the endpoints the page gives, plus the previous entry of each one it no longer
 * gives, so that a changed layout never takes an endpoint out of the library on its own.
 */
export function merged(before: DocEndpoint[], after: DocEndpoint[]): DocEndpoint[] {
  const paths = new Set(after.map((e) => e.path));
  return [...after, ...before.filter((e) => !paths.has(e.path))];
}

async function main(): Promise<number> {
  let html: string;
  try {
    const res = await fetch(DOCS, {
      headers: { "user-agent": "igdb-kit (+https://github.com/7IBO/igdb-kit)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (error) {
    console.log(
      `\n**Could not read IGDB's API docs (${DOCS}): ${error instanceof Error ? error.message : error}.**`,
    );
    return 1;
  }
  const after = parseDocs(html);
  const before: DocEndpoint[] = JSON.parse(readFileSync(OUT, "utf8"));
  if (after.length < before.length - MAX_MISSING) {
    console.log(
      `\n**IGDB's API docs gave ${after.length} endpoints, against ${before.length} before: codegen/docs-fields.json was left as it was.**`,
    );
    return 1;
  }
  const diff = changes(before, after);
  if (diff.length) {
    writeFileSync(OUT, `${JSON.stringify(merged(before, after), null, 1)}\n`);
    console.log(`\n## IGDB's API docs\n\nRead each change before merging.\n\n${diff.join("\n")}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
