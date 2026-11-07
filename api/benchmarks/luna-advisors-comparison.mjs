import { benchmark } from './agent-comparison.mjs';

await benchmark({
  repeats: 2,
  variants: ['full-chat', 'langgraph-advisors'],
  suite: 'luna-full-chat-vs-advisors',
  output: 'docs/verification/luna-advisors-comparison-2026-11-07.json',
  envOverrides: { LLM_MODEL: 'gpt-5.6-luna', LLM_REASONING_ENABLED: 'false' },
});
