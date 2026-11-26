---
"igdb-kit": minor
---

`webhookRouter({ secret })` of `igdb-kit/webhooks` routes IGDB's deliveries with `.on(endpoint, operation | operations, handler)`: a create or an update gets the entity, a delete its `{ id }`, typed by endpoint. `hooks.handler` answers deliveries like `webhookHandler`, `hooks.dispatch(event)` runs the handlers of an event from `parseWebhook()`, and `igdb.webhooks.ensure({ url, secret, routes: hooks.routes })` registers only the pairs the router handles. `ensure()` now throws a `TypeError` when given both `endpoints` and `routes`, neither, or `operations` with `routes`, registers a pair given twice once, and `EnsureWebhooksOptions.endpoints` is optional. `parseWebhook()` refuses an endpoint named after an object property (`constructor`). `webhookHandler`'s `onEvent` may return any value, which is awaited. New class `WebhookRouter`, new types `WebhookData`, `WebhookRoute`, `WebhookRouteEvent`, `WebhookRouteHandler` and `WebhookRouterOptions`.
