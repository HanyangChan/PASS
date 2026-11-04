import { createAgentRunner } from '../runtime.mjs';

/** Starter only: implement 입력 복잡도에 따른 해석기 분리 here. */
export async function interpretMessage({ text, state }) {
  // text and state are data. Return confirmed condition changes only.
  // Put provider calls, prompts and internal modules in this directory.
  return {
    patch: {},
    questions: ['이 에이전트의 자유 발화 해석은 아직 구현 전입니다. 조건 편집으로 입력해 주세요.'],
    unresolved: true,
  };
}

export function createAgent({ interpret = interpretMessage } = {}) {
  return { id: 'e-tiered', runTurn: createAgentRunner({ interpret }) };
}
