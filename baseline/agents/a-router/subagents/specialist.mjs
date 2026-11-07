import { specialistPrompt } from './prompts.mjs';
import { FIELDS, validateAnalysis } from './contracts.mjs';
export function runSpecialist(role,run,context,task) {
  const fields=new Set(['recipients',...FIELDS[role].map(f=>f.split('.')[0])]);
  const state=Object.fromEntries(Object.entries(context.state).filter(([key])=>fields.has(key)));
  return run(role,{system:specialistPrompt(role),payload:{...context,state,task},maxTokens:500,validate:data=>validateAnalysis(data,role,context.sources)});
}
