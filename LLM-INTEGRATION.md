# Single-gift chat and LLM integration

The public chat now recommends one gift. Quantity, same-product selection, and total-versus-per-set budget controls are removed. Budget means the price of one gift. The historical recommendation engine retains its internal quantity fields for compatibility; the public adapter always supplies one item. Older multi-item diagnostic fixtures are historical, not evidence for the new public flow.

`POST /api/chat` supports server-side Gemini structured extraction. `GEMINI_API_KEY` must be configured as a Sites server secret; optional `GEMINI_MODEL` defaults to `gemini-3.6-flash`. Never put keys in client code or commit them. See the [official Gemini structured outputs guide](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

The model extracts conditions only. Catalog eligibility, prices, ranking, and counterfactual recommendations remain deterministic. The request includes current conditions and up to six recent messages, uses `store: false`, and validates returned fields. An API failure preserves the current user state. Without a key the app explicitly displays basic rule-based interpretation; this is not a live LLM connection.

Validation covers mocked Gemini structured extraction, invalid payloads, allergy preservation, and quantity removal. A missing or unavailable Gemini key falls back to the rule-based interpreter. A real Gemini API call still requires the production `GEMINI_API_KEY` secret.

The study identifier is now `pass-explanation-pilot-v2-single-gift`; both study tasks use one gift. Keep prior v1 results separate when analyzing study data.
