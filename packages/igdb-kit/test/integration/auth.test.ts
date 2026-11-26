// Refused credentials on the real Twitch endpoint. Skipped unless TWITCH_CLIENT_ID is set. Sends one
// token request, with a wrong secret.
import { describe, expect, test } from "bun:test";
import { AuthError, type AuthErrorInfo, createIGDB } from "../../src";

const clientId = process.env.TWITCH_CLIENT_ID;

describe.skipIf(!clientId)("refused credentials", () => {
  test("hooks.onAuthError hears Twitch refuse a wrong secret, once", async () => {
    const seen: AuthErrorInfo[] = [];
    const igdb = createIGDB({
      clientId: clientId as string,
      clientSecret: "not-the-secret",
      hooks: { onAuthError: (info) => seen.push(info) },
    });
    const results = await Promise.allSettled(
      [1942, 1020].map((id) => igdb.games.select("name").findById(id)),
    );
    expect(results.map((r) => r.status === "rejected" && r.reason instanceof AuthError)).toEqual([
      true,
      true,
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ path: "oauth2/token", tokenValid: false });
  });
});
