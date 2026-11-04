// Full pipeline entry point (TRD §1). index.mjs keeps the common port; servers and eval use this.
import { createOrchestrator } from './orchestrator.mjs';
export { REQUEST_KINDS, EXPERIMENTS } from './orchestrator.mjs';

/**
 * createPipeline({store, products, llm?, explain?, now?}) -> {runPipelineTurn, explainCards}
 * No LLM is created here: the caller passes one (server: from .env; tests: llm/fake.mjs or null).
 */
export function createPipeline(deps) {
  return createOrchestrator(deps);
}
