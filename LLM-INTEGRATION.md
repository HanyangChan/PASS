# Single-gift chat and LLM integration

The public chat now recommends one gift. Quantity, same-product selection, and total-versus-per-set budget controls are removed. Budget means the price of one gift. The historical recommendation engine retains its internal quantity fields for compatibility; the public adapter always supplies one item. Older multi-item diagnostic fixtures are historical, not evidence for the new public flow.

`POST /api/chat` supports server-side OpenAI Responses API structured extraction. `OPENAI_API_KEY` must be configured as a Sites server secret; optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Provision credentials through the OpenAI Developers plugin workflow. Never put keys in client code or commit them. See the [official structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

The model extracts conditions only. Catalog eligibility, prices, ranking, and counterfactual recommendations remain deterministic. The request includes current conditions and up to six recent messages, uses `store: false`, and validates returned fields. An API failure preserves the current user state. Without a key the app explicitly displays basic rule-based interpretation; this is not a live LLM connection.

Validation on 2026-09-16: 55 automated tests passed, including mocked Responses API extraction, invalid payloads, allergy preservation, and quantity removal. Production build passed. Local API smoke tests confirmed missing-key fallback and cross-origin rejection. No real OpenAI API call has been verified: credential activation is pending.

The study identifier is now `pass-explanation-pilot-v2-single-gift`; both study tasks use one gift. Keep prior v1 results separate when analyzing study data.
