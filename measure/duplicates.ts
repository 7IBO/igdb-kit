// Temporary: tries duplicateCandidates() on a real sample of IGDB. Removed before merge.
import { createIGDB } from "../packages/igdb-kit/src";
import { duplicateCandidates, duplicateFields } from "../packages/igdb-kit/src/game";

const igdb = createIGDB({ clientId: process.env.TWITCH_CLIENT_ID!, clientSecret: process.env.TWITCH_CLIENT_SECRET! });
const [last] = await igdb.games.select("id").sort("id", "desc").limit(1).execute();
let seed = 2026;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const randomIds = [...new Set(Array.from({ length: 3000 }, () => 1 + Math.floor(rand() * (last as { id: number }).id)))];
const random = await igdb.games.select("name").where("game_type = (0,4,8,9,10,11) & version_parent = null").findByIds(randomIds).execute();
const recent = await igdb.games.select("name").where("game_type = (0,4,8,9,10,11) & version_parent = null").sort("id", "desc").limit(500).execute();
const recent2 = await igdb.games.select("name").where(`game_type = (0,4,8,9,10,11) & version_parent = null & id < ${(recent.at(-1) as { id: number }).id}`).sort("id", "desc").limit(500).execute();

for (const [label, seeds] of [["random", random], ["recent", [...recent, ...recent2]]] as const) {
  const names = [...new Set(seeds.flatMap((g) => ((g as { name?: string }).name ? [(g as { name: string }).name] : [])))];
  const games = new Map<number, any>();
  for (let i = 0; i < names.length; i += 40) {
    const list = names.slice(i, i + 40).map((n) => JSON.stringify(n)).join(",");
    const rows = await igdb.games
      .select(...duplicateFields(), "involved_companies.company.name", "platforms.abbreviation", "slug", "summary")
      .where(`name = (${list})`)
      .limit(500)
      .execute();
    for (const g of rows as any[]) {
      g.involved_companies = g.involved_companies?.map((c: any) => ({ ...c, company: c.company?.id, companyName: c.company?.name }));
      g.platformNames = g.platforms?.map((p: any) => p.abbreviation);
      g.platforms = g.platforms?.map((p: any) => p.id);
      games.set(g.id, g);
    }
  }
  const all = duplicateCandidates([...games.values()], { minScore: 0 });
  const kept = all.filter((p) => p.score >= 0.7);
  const buckets = [0.6, 0.7, 0.8, 0.9, 1.01].map((t, i, a) => [i ? a[i - 1] : 0, t]).map(([lo, hi]) => `${lo}-${hi}: ${all.filter((p) => p.score >= lo! && p.score < hi!).length}`);
  console.log("SUMMARY", label, "seeds", seeds.length, "names", names.length, "games read", games.size, "pairs>=0.7", kept.length, buckets.join(" | "));
  for (const p of kept) {
    const show = (g: any) => ({
      id: g.id,
      name: g.name,
      type: g.game_type,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
      platforms: g.platformNames,
      dev: g.involved_companies?.filter((c: any) => c.developer).map((c: any) => c.companyName),
      slug: g.slug,
      summary: g.summary?.slice(0, 160),
      sites: g.websites?.map((w: any) => w.url),
    });
    console.log("PAIR", label, p.score, p.reasons.join(","), p.conflicts.join(","), JSON.stringify(p.games.map(show)));
  }
}
