# UPSTREAM — main 프로토타입 복사본

원본: main 커밋 `6beb5af` (Add per-architecture agent workspaces and shared baseline adapter). 복사 일자 2026-11-05.
이 파일은 `scripts/check-proto-sync.mjs`가 읽는다. 표 형식(`| \`경로\` | ... |`)을 바꾸지 않는다.

- `proto/lib/` = main `lib/` 중 `test-dialogues.json`(main 테스트 전용 데이터)을 뺀 전부, `proto/api/worker.mjs` = main `api/worker.mjs`. 테스트 파일(`api/tests/`)은 복사하지 않았다(K56).
- `app/` = main `mobile/` 복사본(이미 있음). `mobile/tests/`·`.env.example`은 복사하지 않았다.
- 원본과 다른 파일은 아래 "패치된 파일"에, 원본에 없는 파일은 "추가된 파일"에 이유와 함께 적는다. 목록 밖 수정은 `npm test`의 proto-sync가 막는다.

## 원본 해시
| 파일 | SHA-256 (main 6beb5af) |
|---|---|
| `app/.gitignore` | 5936b94a73a28b6735de672b54c2c058a33c9ae1edb62d87d6a4418e14447805 |
| `app/AGENTS.md` | b7d381dd55800d242252e8bf89a40b026586d254e34908210931bc35582396a3 |
| `app/ATTRIBUTIONS.md` | 7eef0ed2b6fb8a4d85c6217fbcbebfdedc8e4ac286d55920ea8de35167baa89f |
| `app/App.tsx` | eaf05ef281c46954fac3197ee868eafdbc2aa06de34c43b745a21a48538c69a7 |
| `app/LICENSE` | fb3ca4a837f5779e83cef89b78253a8949cfb9429c340309f62d0465ec6610b4 |
| `app/README.md` | 9ea067b7df2685c21f7e7502258151baef5544fc20c20660825807bcff7f341e |
| `app/app.json` | 7a46274698c8ccdcc13a3e279f95d595d33ab1f388571a36fc06c48b68aa9baa |
| `app/assets/android-icon-background.png` | fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d |
| `app/assets/android-icon-foreground.png` | 9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391 |
| `app/assets/android-icon-monochrome.png` | 6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83 |
| `app/assets/favicon.png` | a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba |
| `app/assets/figma/check.svg` | 32e3c1d50cee4bf3c4b4d2df8d5b7bbd6a572d104c9361ad055d3ac8bac6e14f |
| `app/assets/figma/chevron.svg` | 88f773b48a1a8cda43c21db4d45c11362bba9a063c2a8d35674f9f7116863322 |
| `app/assets/figma/coffee.svg` | 748faaa2faa76e8dc25bf3d657382ee1ef4a72432e30929ed8c881095007b9cb |
| `app/assets/figma/filter.svg` | 87e5a170b7b0797825cbc3412155d1565d6d66b804c1dc490793e5c4e77e50db |
| `app/assets/figma/fruit.svg` | b6efa7b6cce82dc11cf0603edfc66f70c5799609871edb9605acee5f8ce1bec2 |
| `app/assets/figma/gift.svg` | 6264d25c006f8391fdfa669b4c4eb5f6d924f0397292a2a3e42fe71519eab7b4 |
| `app/assets/figma/hangwa.svg` | 0575f166f4b6e7ef064a90d2a6af08f333fd46c920cddd95a6c160231fbf186d |
| `app/assets/figma/heart.svg` | 99de87d1628382232b4a4d717b86e0820d4ca6f504300c985512396cce825e1a |
| `app/assets/figma/nuts.svg` | efa3c86e0993b0fd5700f578b15aa2692367d80a4c099ac4900fb950e81707ed |
| `app/assets/figma/oil.svg` | 56f7c36bd9051c248bdce3c893719e6e950839190a28fb20c0c5a1a23cf17adb |
| `app/assets/figma/search.svg` | 4b8f67b03f54436166e6eba8d7c3887701af5c34a7ab90ada6f40cacade90418 |
| `app/assets/figma/tea.svg` | c47749dadca93c9c895550a005898f49a0f79bab4604b0fd280b3b8458dfcbf5 |
| `app/assets/icon.png` | 119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f |
| `app/assets/splash-icon.png` | 5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8 |
| `app/eas.json` | 131a345b422c6c63383f0459c76de090c0ed7db2bc9661d7a8c29894993e485b |
| `app/eslint.config.js` | 442c7d6268e3727a7c949be077d8bb0c4b7d7f6542e36d6b4e2be6a22d4deea7 |
| `app/metro.config.js` | 87e9c5a10acb03fe2806b07d226529b4b74cc545164bd5047a7a10981c19fe6f |
| `app/package-lock.json` | c8b3075c6a5e1b2dc16966fb00030d5af966d4f1980b1f2f6a1401e01d1fd579 |
| `app/package.json` | d8fb7d4c4b06f032c1b7c465b1b6f96b416a2ce3cc8ba838b87a5c32acb4c55a |
| `app/public/architecture.svg` | cd71f1410eb420588e753d4cc868d1876b35bc632855460a7f5c05baf1da1d04 |
| `app/scripts/patch-speech-recognition.cjs` | 2e8291a3f7188b3d2b45a55333a3ecb4dd45b2b786bccd1ca2c22945218bf3b5 |
| `app/src/AttachmentPicker.tsx` | ac1787f0b828edefb32cb28664668ba24ae6f255087c1c1562d85a9167612da6 |
| `app/src/ChatTools.tsx` | 099be65f11d642c94dced87d800fe82ced57a19f430c0575ce893d204e995fa7 |
| `app/src/PersonalizationPanel.tsx` | 63e119d7a007e749e78128c8c3e9e890e2e0e55da74d54a04ad0d9516fcc01a2 |
| `app/src/PrototypeFlows.tsx` | 6419fbaf06b977e366cbd390eb3ace9faccc21bfa7623a1cca2c78ec6b4acf1c |
| `app/src/app/_layout.tsx` | ae29f8582ab4f57bb4893a4f80335879f1a7349d10b7d43a3863ea3ee99f4598 |
| `app/src/app/account.tsx` | 340771efed511cb317a2064ece497faffcde2909ff8aca917deb8e8a3c3c495a |
| `app/src/app/calendar.tsx` | a1f81ea5b87c3ce936940eeca54fe9de42d1b1bffe2e1ae092734d3ba800762e |
| `app/src/app/chat.tsx` | d0f32b02cb69d52e56b09552ab8f2cca2b975ce2980a76714d7c8f4976486a1b |
| `app/src/app/gift-complete.tsx` | 87912b63784ce1b6056dbab911ab3c35bdef765d508da034b82f225024564f5b |
| `app/src/app/gift-confirm.tsx` | 4ce1b41a0bafdf82dd40206bc98ea619a374e20be26b3a93e4e408c1f9e2b2fa |
| `app/src/app/gift.tsx` | defc2beb00b5593d728f9b95963e42db23fbc88419b4322e064def30085b9819 |
| `app/src/app/index.tsx` | d19393e61ebbef58ef97a815e7a9acf67b3c557956caff7d34b892901d3aedc8 |
| `app/src/app/login.tsx` | c6c41bc0a99f9f9d13791f46bae3f74542679423127d420a5a5790af22c932f0 |
| `app/src/app/mypage.tsx` | fa9ae2a3a4aa88a00b436d00dde16bbd0ea8a56cd2078a67bb21e1cd70360869 |
| `app/src/app/ranking.tsx` | 8a9c799b177d3fddc0bb2b7ef7e6b4fe3b047d52b61e80d16a73db05d863a77f |
| `app/src/app/results.tsx` | ff1f0395c529e25bde0335df08072ec2e8ff0ccbfe7dfa579556bdf8cc04de80 |
| `app/src/assets.d.ts` | 0946cfafe4cb6e4e74cb1bcaf89cd97c505f99bdcd0ec0ff0ab2407c7be2d649 |
| `app/src/auth/AuthPanel.tsx` | 46460b8df2f6e468681b8fad72fe3b12ebd0ee93d96946fe3bbe039697ca5add |
| `app/src/auth/AuthProvider.tsx` | afda3849a62accfdf7200ec3b18797c9272a09a6180268db036f0cd0e1af1502 |
| `app/src/auth/client.ts` | a15d6a631f9d4a9183d0c5f7d6040fcc491a972d709e77c66a666b91ef600897 |
| `app/src/auth/config.ts` | cf16adb54e92900f059508ba5586afa9613e8674ddee2cae9d4e41e48b87f97a |
| `app/src/auth/secureSessionStorage.ts` | 8c3d6e4c13133602f3be61f84686643583aaea9333d21e9fafcb6b3cc4bba0e4 |
| `app/src/catalog.ts` | 87ea9d0f49d766186333cd4a7f9865b6c5c8f13d02a0efb3016a25094b177e37 |
| `app/src/components.tsx` | 9ce3809559f12094f9f020a0aa8fcbff21137bb2a1af7abe6020a30a946ee7f2 |
| `app/src/design-source.md` | d999524495ad0da71c1535fc5ceb5625719cb440d9c21e8e081743128d02d805 |
| `app/src/domain.ts` | 4d73a3fa907325f599a69118562ca6c736f2f8d0c82a888f936f2f21703b373b |
| `app/src/prototype-flow-reference.md` | 125b324542cd91ea03620701b2f53949b812823997251f650f6148c01c6cd7ba |
| `app/src/services/authService.ts` | da4083d627d2e816b13a5ccd13187d432f1c93ce3442bfcbe8db87d67837e658 |
| `app/src/services/calendarDates.ts` | 02005544452330c542640e1d6bedcb59bdab212ad3d8875cfb333522b024dd8d |
| `app/src/services/calendarRepository.ts` | 22aec9171a4a721919dc8d7cf81365b596fc8efb0a8ad9cf379a4e19410bd157 |
| `app/src/services/chatService.ts` | 3281ab3d958511236672c3e749e1a6c1bece782977844eba8577b488e7677062 |
| `app/src/services/cloudRecords.ts` | f49d680fff836c5dfc9d2fa0fd5250b8b7a64155ce63bfedf55339826df959cc |
| `app/src/services/conditionLabels.ts` | 2306ad84bf3d7909266c3ab303855a1bac2a1f8e4382610d0f8276f3801ca2d4 |
| `app/src/services/giftRepository.ts` | 178e95d4d964fb0a6017679e5bfc28514abd7043dbb9705c7fe6a1ad11216243 |
| `app/src/services/localServices.ts` | 5b2645100bd7affeac9fc035daa027f371ec420c9d6171435767661aa8de5412 |
| `app/src/services/personalization.ts` | 5d680b3b781563ac2701ab98e00003a96516ab3c22f7fef86783adfba36456a1 |
| `app/src/services/productRepository.ts` | 37ac978ea3801cee1d9217345d0750040d42ecdcc3b2428985e61d9c5967d931 |
| `app/src/services/serverChatService.ts` | 21fb673351dde5dd0c1e59fb2897392e7688694a4f15449231b358ad03e2f267 |
| `app/src/services/snapshotPersistence.ts` | 71dd47ff3a67bf258031ab2b2f0b109675d824ea99bd1fdf6fa089ab9109e5c1 |
| `app/src/storage.ts` | 090de89ced47bd9463c4299bdb9225075142f819ca44720a893069f266b64e7a |
| `app/src/theme.ts` | b23e47c9afb05c9905ea1f0e28b466b5ab2b754d7ed45270c439e42f18af1016 |
| `app/src/usePersonalization.ts` | ca341f2af2d18cb183c7f345860538217a22de02d1655c56b61f947d6b4a27da |
| `app/src/voiceSession.mjs` | 844e58b4f4e259d4bacd3d38b71b03cc62abe844250aa974605b96ad321478c1 |
| `app/tsconfig.json` | 3b8fb0acbe51cfeeee3677269172c4e3680184c1b0b542b2ad132e499d3179b0 |
| `proto/api/worker.mjs` | d16d12105429995d9286c5dec45f6cb6573e6c22b0beea423949d42067139279 |
| `proto/lib/allergens.mjs` | b04cc6d5ae8fd7f3f03212260a0c9a7d4feea3c63d7e1b6aabc2a0acb561e85c |
| `proto/lib/catalog.mjs` | 629179a699ed10429eb45e0a06add067f83fd16fdec1d4d7ea8defa391daa831 |
| `proto/lib/condition-compat.mjs` | e200d9f4c826ea0a2c64f7258a9e4b06166cd0ab089ca5c0ad31f1bcf1dbb71c |
| `proto/lib/conversation.mjs` | f7bad7a4dc288f69109b38278e10a3ad42f7bedfcf7bf5a2e44c2841b386f797 |
| `proto/lib/counterfactual.mjs` | 3c6349be60b0e4d6fc0d9da82cc4f6a6f863a2ef0d139320e7613111b01fabfd |
| `proto/lib/engine.mjs` | 0ffaa02671afd6770862f6559455eb185a98e6bd014dfe4f3dd776cbe64a4a01 |
| `proto/lib/language.mjs` | d8e763f7f19f8517f10d8ede2f1ec27f3d64b7b6a4f911d7cd756638a405312d |
| `proto/lib/llm.mjs` | 171dc5637fca18465898ae949fd3f48c19a82dfedb987acd4af9986ca90738db |
| `proto/lib/single-gift.mjs` | f7f92a8b3bcd128c7935b512dade9b46689ba3ae94bacd29318da96c97c77f8c |

## 패치된 파일
P7 시점의 현재 상태다. P8~P10에서 PROTO-REBASE §4의 L1~L3·A1~A4만 남기고 줄인다.

| 파일 | 패치 | 이후 |
|---|---|---|
| `app/App.tsx` | R1 import 경로 + P6 파이프라인 모드 병렬(SSE) 경로 약 97줄 | P10에서 A4 + 30줄 이내로 축소 |
| `app/metro.config.js` | R1 watchFolders | P10까지 유지 (A1로 대체 예정) |
| `app/package.json` | R1 `test:db` 제거 | — |
| `app/src/catalog.ts` | R1 lib import 경로 | A1 |
| `app/src/PrototypeFlows.tsx` | P6 pipeline 컨텍스트 사용 | P10 A4 |
| `app/src/services/chatService.ts` | R1 lib import 경로 | A1 |
| `app/src/services/cloudRecords.ts` | R1 lib import 경로 | A1 |
| `app/src/services/conditionLabels.ts` | R1 lib import 경로 | A1 |
| `app/src/services/personalization.ts` | R1 lib import 경로 + 파이프라인 모드 분기 | A1, A3 |
| `app/src/services/productRepository.ts` | R1 lib import 경로 | A1 |
| `app/src/services/serverChatService.ts` | R1 lib import 경로 | A1, A2 |
| `proto/lib/llm.mjs` | L1 `extractionSchema`에 선택 필드 `memory[{recipient,key,polarity,evidence}]` + 지시문 한 줄, `llmTurn`이 `memory`를 상태와 분리해 반환 · L2 `timeoutMs`(기본 18000)·선택 `thinkingBudget`(400이면 빼고 1회 재시도) · L4 선택 옵션 `generate`(있으면 Gemini 호출 대신 공용 OpenAI 호환 클라이언트에 같은 지시문·`extractionSchema`를 넘김, Gemini 호출은 `geminiCall`로 옮김, 검증·알레르기 합집합·`finishSingle`은 그대로, K72) | P8 · K72 |

## 추가된 파일

| 파일 | 내용 | 이후 |
|---|---|---|
| `app/src/PipelineExtras.tsx` | P6 반영 한 줄·칩 UI | A4 |
| `app/src/services/pipelineChatService.ts` | P6 SSE 서비스 | P10에서 삭제 |
| `app/src/services/pipelineEvents.mjs` | P6 응답 검증 | A2에서 유지 |
