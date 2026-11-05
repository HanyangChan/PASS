import { supervisorPrompt } from './prompts.mjs';
import { validateSelection } from './contracts.mjs';
export const runSupervisor=(run,context)=>run('supervisor',{system:supervisorPrompt,payload:context,maxTokens:700,validate:data=>validateSelection(data,context.sources)});
