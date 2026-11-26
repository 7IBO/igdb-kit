import { describe, expect, test } from "bun:test";
import { changes, parseDocs, textOf } from "../../scripts/docs-fields";

// Two sections shaped like the docs page: a heading, the address, then the table of fields. A third
// section, a guide, has neither and is skipped.
const PAGE = `<h1 id="getting-started">Getting Started</h1><p>Read https://api.igdb.com/v4/games for more.</p>
<h2 id="age-rating">Age Rating</h2>
<pre>https://api.igdb.com/v4/age_ratings</pre>
<table><thead><tr><th>field</th><th>type</th><th>description</th></tr></thead><tbody>
<tr><td>category</td><td>Category Enum</td><td>DEPRECATED! Use <code>organization</code> instead</td></tr>
<tr><td>checksum</td><td>uuid</td><td>Hash of the object</td></tr>
</tbody></table>
<h2 id="cover">Cover</h2>
<p><code>https://api.igdb.com/v4/covers</code></p>
<table><tr><th>field</th><th>type</th><th>description</th></tr>
<tr><td>image_type</td><td>Reference ID for Image Type</td><td>The image type &amp; its kind</td></tr>
<tr><td>width</td><td>Integer</td><td></td></tr></table>`;

describe("API docs", () => {
  test("reads each endpoint's name, path and fields, and skips sections without a table", () => {
    expect(parseDocs(PAGE)).toEqual([
      {
        name: "Age Rating",
        path: "age_ratings",
        fields: [
          { name: "category", type: "Category Enum", desc: "DEPRECATED! Use organization instead" },
          { name: "checksum", type: "uuid", desc: "Hash of the object" },
        ],
      },
      {
        name: "Cover",
        path: "covers",
        fields: [
          { name: "image_type", type: "Reference ID for Image Type", desc: "The image type & its kind" },
          { name: "width", type: "Integer", desc: "" },
        ],
      },
    ]);
  });

  test("decodes entities and collapses spaces", () => {
    expect(textOf("A&nbsp;<b>bold</b>\n  &#39;word&#39; &lt;3")).toBe("A bold 'word' <3");
  });

  test("lists new, changed and removed endpoints and fields", () => {
    const before = parseDocs(PAGE);
    const after = structuredClone(before);
    after[0]?.fields.push({ name: "organization", type: "Reference ID", desc: "Who rated it" });
    if (after[1]) after[1].fields = [{ name: "width", type: "Integer", desc: "The width in pixels" }];
    after.push({ name: "Logo", path: "logos", fields: [{ name: "image_id", type: "String", desc: "" }] });
    expect(changes(before, after)).toEqual([
      "- `age_ratings.organization` is documented: Who rated it",
      "- `covers.width`: Integer, The width in pixels",
      "- `covers.image_type` left the docs",
      "- New endpoint `logos`",
    ]);
    expect(changes(before, before)).toEqual([]);
    expect(changes(before, before.slice(1))).toEqual(["- Endpoint `age_ratings` left the docs"]);
  });
});
