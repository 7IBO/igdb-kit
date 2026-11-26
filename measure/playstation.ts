// Temporary: measures how many PlayStation title ids IGDB can tie to a game. Removed before merge.
const sample: { set: string; platform: string; titleId: string; conceptId: string; name: string; region: string }[] =
  await Bun.file(new URL("./sample.json", import.meta.url)).json();
const auth = await fetch(
  `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  { method: "POST" },
).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function q(path: string, body: string): Promise<any> {
  for (let i = 0; i < 5; i++) {
    await sleep(300);
    const r = await fetch(`https://api.igdb.com/v4/${path}`, {
      method: "POST",
      headers: { "Client-ID": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${auth.access_token}` },
      body,
    });
    if (r.ok) return r.json();
    console.error(path, r.status, (await r.text()).slice(0, 200));
    await sleep(2000);
  }
  throw new Error(path);
}
const counts: Record<string, unknown> = {};
for (const [k, w] of Object.entries({
  ps_links: 'url ~ *"store.playstation.com"*',
  ps_product_links: 'url ~ *"store.playstation.com"* & url ~ *"/product/"*',
  ps_links_ppsa: 'url ~ *"store.playstation.com"* & url ~ *"PPSA"*',
  ps_links_cusa: 'url ~ *"store.playstation.com"* & url ~ *"CUSA"*',
})) counts[k] = (await q("websites/count", `where ${w};`)).count;
counts.ext_ps = (await q("external_games/count", "where external_game_source = 36;")).count;
counts.ext_any_code = (await q("external_games/count", 'where uid ~ *"PPSA"* | uid ~ *"CUSA"* | url ~ *"PPSA"* | url ~ *"CUSA"*;')).count;
console.log("COUNTS", JSON.stringify(counts));

const byLink = new Map<string, { game: number; url: string }[]>();
for (let i = 0; i < sample.length; i += 10) {
  const chunk = sample.slice(i, i + 10);
  const where = chunk.map((s) => `url ~ *"${s.titleId.slice(0, 9)}"*`).join(" | ");
  const rows = await q("websites", `fields url,game; where ${where}; limit 500;`);
  for (const row of rows) {
    const s = chunk.find((c) => row.url.toUpperCase().includes(c.titleId.slice(0, 9)));
    if (!s) continue;
    byLink.set(s.titleId, [...(byLink.get(s.titleId) ?? []), { game: row.game, url: row.url }]);
  }
}
const byConcept = new Map<string, number[]>();
const concepts = [...new Set(sample.map((s) => s.conceptId))];
for (let i = 0; i < concepts.length; i += 100) {
  const chunk = concepts.slice(i, i + 100);
  const rows = await q(
    "external_games",
    `fields uid,game; where external_game_source = 36 & uid = (${chunk.map((c) => `"${c}"`).join(",")}); limit 500;`,
  );
  for (const row of rows) byConcept.set(row.uid, [...(byConcept.get(row.uid) ?? []), row.game]);
}
const gameIds = [...new Set([...byLink.values()].flat().map((l) => l.game).concat([...byConcept.values()].flat()))];
const games = new Map<number, any>();
for (let i = 0; i < gameIds.length; i += 500) {
  const rows = await q("games", `fields name,game_type,version_parent,parent_game; where id = (${gameIds.slice(i, i + 500).join(",")}); limit 500;`);
  for (const g of rows) games.set(g.id, g);
}
const out = sample.map((s) => ({
  ...s,
  link: (byLink.get(s.titleId) ?? []).map((l) => ({ ...l, g: games.get(l.game) })),
  concept: (byConcept.get(s.conceptId) ?? []).map((id) => games.get(id)),
}));
for (const set of ["random", "multiregion"]) {
  for (const platform of ["ps4", "ps5", "all"]) {
    const rows = out.filter((r) => r.set === set && (platform === "all" || r.platform === platform));
    const link = rows.filter((r) => r.link.length).length;
    const concept = rows.filter((r) => r.concept.length).length;
    const either = rows.filter((r) => r.link.length || r.concept.length).length;
    const linkAmbiguous = rows.filter((r) => new Set(r.link.map((l) => l.game)).size > 1).length;
    console.log("RATE", set, platform, rows.length, "link", link, "ambiguous", linkAmbiguous, "concept", concept, "either", either);
  }
}
console.log("ROWS", JSON.stringify(out));
