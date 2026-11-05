import { synthesizerPrompt } from './prompts.mjs';
import { validateSynthesis } from './contracts.mjs';
export const runSynthesizer=(run,prepared)=>run('synthesizer',{system:synthesizerPrompt,payload:prepared,maxTokens:700,validate:data=>validateSynthesis(data,prepared)});
