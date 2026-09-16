# Single-gift chat and LLM integration

The public chat now recommends one gift. Quantity, same-product selection, and total-versus-per-set budget controls are removed. Budget means the price of one gift. The historical recommendation engine retains its internal quantity fields for compatibility; the public adapter always supplies one item. Older multi-item diagnostic fixtures are historical, not evidence for the new public flow.

`POST /api/chat` supports server-side xAI Responses API structured extraction. `XAI_API_KEY` must be configured as a Sites server secret; optional `XAI_MODEL` defaults to `grok-4.6`. Never put keys in client code or commit them. See the [official xAI structured outputs guide](https://docs.x.ai/developers/model-capabilities/text/structured-outputs).

The model extracts conditions only. Catalog eligibility, prices, ranking, and counterfactual recommendations remain deterministic. The request includes current conditions and up to six recent messages, uses `store: false`, and validates returned fields. An API failure preserves the current user state. Without a key the app explicitly displays basic rule-based interpretation; this is not a live LLM connection.

Validation covers mocked xAI Responses API extraction, invalid payloads, allergy preservation, and quantity removal. A missing key falls back to the rule-based interpreter. A real xAI API call still requires the production `XAI_API_KEY` secret.

The study identifier is now `pass-explanation-pilot-v2-single-gift`; both study tasks use one gift. Keep prior v1 results separate when analyzing study data.
