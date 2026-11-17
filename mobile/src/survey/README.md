# Survey recording view

This folder contains the minimal participant-facing recording wrapper for the existing PASS shopping chatbot.

## Running

From `mobile/`, run `npm install` and `npm run web`. Open `/survey` rather than `/chat`.

The recording screen reuses the original chat layout, recommendation cards, chat input, and recommendation service. It hides the visible A/B/C/D mode slider and the internal advisor panel; it does **not** include Google Forms or collect survey answers.

## Operator setup (not for participants)

Before beginning a recording, select the backend with a URL such as:

- `/survey?mode=a-router`
- `/survey?mode=full-chat`

The other existing backend modes are `langgraph-advisors` and `full-chat-feedback-2`. The query parameter is **not secret**: hide the browser address bar by recording only the app window, and do not share setup URLs with participants. Open the page and confirm the selected backend before capturing the first frame. Record all conditions at the same viewport size, using the same script, input text, number of product cards, and similar pacing.

**Research caveat:** Existing backend agent modes are not automatically equivalent to the proposed 2×2 study's LLM-use × explanation treatments. This UI change only conceals mode controls and advisor internals. To make explanation ON/OFF a valid experimental manipulation, the corresponding response and recommendation explanation generation must also be controlled in the backend, and visible recommendation explanations must be checked before recording. Avoid using a hidden panel as a substitute for disabling explanations: the product cards still show their normal recommendation reasons.

## Scope

- Preserve existing chat and product UI
- Hide the mode-selection control and internal advisor/debug panel only in the recording route
- Keep the ordinary /chat screen unchanged
- No participant identity, survey storage, or separate questionnaire interface
