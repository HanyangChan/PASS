// Full pipeline entry point (TRD §1). index.mjs keeps the common port; servers and eval use this.
import { createOrchestrator } from './orchestrator.mjs';
import { createExplainer } from '../explainer/agent.mjs';
export { REQUEST_KINDS, EXPERIMENTS } from './orchestrator.mjs';

/**
 * createPipeline({store, products, llm?, explain?, ragEmbedding?, now?}) -> {runPipelineTurn, explainCards}
 * No LLM is created here: the caller passes one (server: from .env; tests: llm/fake.mjs or null).
 * explain: omitted -> ④ explainer on the same llm (none without an llm); null -> template only.
 */
export function createPipeline(deps) {
  const explain = Object.hasOwn(deps, 'explain') ? deps.explain : createExplainer({ llm: deps.llm ?? null });
  return createOrchestrator({ ...deps, explain });
}
