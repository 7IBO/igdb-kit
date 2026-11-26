---
"igdb-kit": minor
---

`webhookRouter({ secret })` of `igdb-kit/webhooks` routes IGDB's deliveries with `.on(endpoint, operation | operations, handler)`: a create or an update gets the entity, a delete its `{ id }`, typed by endpoint. `hooks.handler` answers deliveries like `webhookHandler`, `hooks.dispatch(event)` runs the handlers of an event from `parseWebhook()`, and `igdb.webhooks.ensure({ url, secret, routes: hooks.routes })` registers only the pairs the router handles. New types `WebhookData`, `WebhookRoute`, `WebhookRouteKey`, `WebhookRouter` and `WebhookRouterOptions`.
