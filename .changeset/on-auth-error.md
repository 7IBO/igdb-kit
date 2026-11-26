---
"igdb-kit": minor
---

`hooks.onAuthError({ path, error, expiresAt })` is called when the credentials are refused, which no retry fixes. Twitch refusing the client id or secret reports `oauth2/token`, once per token request; `expiresAt` is when the token in use expires when only its renewal ahead of expiry was refused, else `null`. IGDB answering 401, or 403 for another reason than the API tier or the query (a token refused after its renewal, a fixed `accessToken`, a proxy's credentials) reports the request's path, once per request. New type `AuthErrorInfo`.
