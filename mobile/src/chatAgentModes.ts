export const chatAgentModes = [
  { id: 'A', agent: 'a-router', title: '규칙 우선', description: '규칙 우선 · 필요할 때 AI 활용' },
  { id: 'B', agent: 'langgraph-advisors', title: '귀속·자문 에이전트', description: '조건의 주인 판단 · 네 자문 의견' },
  { id: 'C', agent: 'full-chat', title: '풀 에이전트', description: '모든 대화에서 AI 판단' },
  { id: 'D', agent: 'full-chat-feedback-2', title: '피드백 에이전트', description: '필요 시 수정 · 최대 2회 검토' },
] as const;

export type ChatAgentMode = typeof chatAgentModes[number]['agent'];
