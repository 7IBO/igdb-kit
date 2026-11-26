---
"igdb-kit": minor
---

`hooks.onAuthError({ path, error, tokenValid })` is called when the credentials are refused, which no retry fixes: Twitch refusing the client id or secret (once per token request, `tokenValid: true` when only the renewal ahead of expiry was refused, so the token still works for a while), or IGDB refusing a token after its renewal, a fixed `accessToken` or a proxy's credentials (once per request). New type `AuthErrorInfo`.
