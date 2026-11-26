// Refreshes codegen/docs-fields.json from IGDB's API docs (https://api-docs.igdb.com), so that the
// descriptions and deprecation notices in the generated types follow the docs: the weekly schema
// update runs it before codegen, and its pull request shows what changed.
//
//   bun run docs-fields
//
// The docs are one page: each endpoint is a section whose heading names it, with its address
// (https://api.igdb.com/v4/<path>) and a table of fields (field, type, description). A page that
// gives fewer than MIN_ENDPOINTS endpoints is a changed layout or an error page: the file is left as
// it is and the script exits with 1, so the run says so instead of erasing the descriptions.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = "https://api-docs.igdb.com/";
const OUT = join(import.meta.dir, "../codegen/docs-fields.json");
const MIN_ENDPOINTS = 70;

export interface DocEndpoint {
  name: string;
  path: string;
  fields: { name: string; type: string; desc: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** The text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(#?\w+);/g,
      (m, e: string) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The endpoints of the docs page, in its order. Sections without an address or a table are skipped. */
export function parseDocs(html: string): DocEndpoint[] {
  const out: DocEndpoint[] = [];
  const headings = [...html.matchAll(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/g)];
  for (const [i, heading] of headings.entries()) {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[i + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const path = section.match(/https:\/\/api\.igdb\.com\/v4\/([a-z0-9_]+)/)?.[1];
    const table = section.match(/<table[\s\S]*?<\/table>/)?.[0];
    if (!path || !table) continue;
    const fields = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map(([, row = ""]) =>
        [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell = ""]) => textOf(cell)),
      )
      .filter((cells) => cells.length >= 2 && /^[a-z0-9_]+$/.test(cells[0] ?? ""))
      .map(([name = "", type = "", desc = ""]) => ({ name, type, desc }));
    if (fields.length) out.push({ name: textOf(heading[2] ?? ""), path, fields });
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
  for (const path of old.keys()) lines.push(`- Endpoint \`${path}\` left the docs`);
  return lines;
}

if (import.meta.main) {
  const res = await fetch(DOCS, {
    headers: { "user-agent": "igdb-kit (+https://github.com/7IBO/igdb-kit)" },
  });
  if (!res.ok) {
    console.log(`\n**Could not read IGDB's API docs (${DOCS}): HTTP ${res.status}.**`);
    process.exit(1);
  }
  const after = parseDocs(await res.text());
  if (after.length < MIN_ENDPOINTS) {
    console.log(
      `\n**IGDB's API docs gave ${after.length} endpoints: codegen/docs-fields.json was left as it was.**`,
    );
    process.exit(1);
  }
  const before: DocEndpoint[] = JSON.parse(readFileSync(OUT, "utf8"));
  const diff = changes(before, after);
  if (diff.length) {
    writeFileSync(OUT, `${JSON.stringify(after, null, 1)}\n`);
    console.log(`\n## IGDB's API docs\n\nRead each change before merging.\n\n${diff.join("\n")}`);
  }
}
