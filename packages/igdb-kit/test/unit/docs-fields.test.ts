import { describe, expect, test } from "bun:test";
import { changes, merged, parseDocs, textOf } from "../../scripts/docs-fields";

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
<tr><td>width</td><td>Integer</td><td></td></tr></table>
<h2 id="images">Images</h2><p>https://api.igdb.com/v4/covers</p>
<table><tr><th>Name</th><th>Size</th></tr><tr><td>cover_small</td><td>90 x 128</td></tr></table>
<h2 id="cover-2">Cover</h2><p>https://api.igdb.com/v4/covers</p>
<table><tr><th>field</th><th>type</th></tr><tr><td>height</td><td>Integer</td></tr></table>`;

describe("API docs", () => {
  test("reads each endpoint's name, path and fields, and skips sections without a table", () => {
    expect(parseDocs(PAGE)).toEqual([
      {
        name: "Age Rating",
        path: "age_ratings",
        anchor: "age-rating",
        fields: [
          { name: "category", type: "Category Enum", desc: "DEPRECATED! Use organization instead" },
          { name: "checksum", type: "uuid", desc: "Hash of the object" },
        ],
      },
      {
        name: "Cover",
        path: "covers",
        anchor: "cover",
        fields: [
          { name: "image_type", type: "Reference ID for Image Type", desc: "The image type & its kind" },
          { name: "width", type: "Integer", desc: "" },
        ],
      },
    ]);
  });

  test("skips a table that does not list fields, and a second section for the same address", () => {
    const paths = parseDocs(PAGE).map((e) => e.path);
    expect(paths).toEqual(["age_ratings", "covers"]);
  });

  test("decodes entities and collapses spaces", () => {
    expect(textOf("A&nbsp;<b>bold</b>\n  &#39;word&#39; &lt;3")).toBe("A bold 'word' <3");
    expect(textOf("It&#x27;s one&hellip; &rsquo;")).toBe("It's one\u2026 \u2019");
    expect(textOf("line<br>break, <code>a</code>.")).toBe("line break, a.");
    expect(textOf("<code>game</code>&#39;s <b>bold</b>er")).toBe("game's bolder");
    expect(textOf("&unknown; &#0;")).toBe("&unknown; &#0;");
  });

  test("keeps an endpoint the page no longer gives, and says so", () => {
    const before = parseDocs(PAGE);
    const after = before.slice(1);
    expect(merged(before, after).map((e) => e.path)).toEqual(["covers", "age_ratings"]);
    expect(merged(before, [{ ...after[0], name: "Covers" } as never]).map((e) => e.name)).toEqual([
      "Cover",
      "Age Rating",
    ]);
    const [first] = before;
    if (!first) throw new Error("no endpoint");
    const renamed = [{ ...first, name: "Age Rating Old" }, ...after];
    expect(changes(before, renamed)).toEqual([
      "- Endpoint `age_ratings` renamed: Age Rating to Age Rating Old",
    ]);
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
    expect(changes(before, before.slice(1))).toEqual([
      "- Endpoint `age_ratings` left the docs: its previous entry is kept (remove it by hand if IGDB dropped it)",
    ]);
  });
});
