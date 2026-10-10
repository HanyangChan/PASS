# PASS Supabase 설정

`migrations/202610100001_initial_pass.sql`은 신규 상품·대화·메시지·선물 기록 테이블과 RLS를 만듭니다. 기존 테이블을 삭제하거나 덮어쓰지 않습니다. 같은 이름의 테이블이 이미 있으면 트랜잭션이 실패하므로 적용 전에 확인하세요.

- `products`: 공개된 상품만 게스트/로그인 사용자가 읽을 수 있습니다. 앱에서는 가격·재고를 수정할 수 없습니다. 실제 상품 데이터는 별도 관리자/서버 수집 작업으로 입력합니다. 가상 추천 카탈로그를 실제 판매 상품으로 자동 등록하지 않습니다.
- `conversations`: 본인 대화와 확정된 조건 JSON만 읽기/쓰기/삭제할 수 있습니다.
- `messages`: 본인 메시지에만 접근합니다. `(conversation_id, user_id)` 복합 외래 키로 다른 사용자의 대화에 메시지를 붙이지 못하게 합니다.
- `gift_records`: 찜·최근·준비 기록의 사용자별 스냅샷입니다. 주문·결제 기록이 아닙니다.

## 실제 프로젝트에 적용

대상 프로젝트를 확인한 뒤 Supabase SQL Editor에서 마이그레이션 전체를 한 번 실행합니다. Supabase CLI를 사용하는 프로젝트라면 기존 원격 마이그레이션 이력을 먼저 동기화하고 `supabase db push`로 적용하세요. 공개 키로는 DB 구조를 바꿀 수 없습니다.

SQL Editor에서 직접 실행한 경우 Supabase CLI의 마이그레이션 이력에는 자동 등록되지 않습니다. 이 파일을 이미 적용한 프로젝트를 나중에 CLI로 관리한다면, 대상 프로젝트를 `supabase link`로 확인한 뒤 `supabase migration repair 202610100001 --status applied`로 이력을 맞추고 다음 마이그레이션을 적용하세요. 이미 적용된 SQL을 다시 실행하지 마세요.

적용 후 SQL Editor에서 다음을 확인합니다.

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('products', 'conversations', 'messages', 'gift_records');

select tablename, policyname, roles, qual, with_check from pg_policies
where schemaname = 'public'
  and tablename in ('products', 'conversations', 'messages', 'gift_records');
```

이 단계의 앱은 실제 Auth를 사용하며 아직 이 테이블에 개인 기록을 업로드하지 않습니다. 다음 단계에서 사용자 JWT로 동기화 서비스를 연결하고, 게스트 기록 가져오기 여부를 사용자에게 선택하게 해야 합니다. 공개 키·JWT로 RLS가 적용되는 경로를 사용하고 관리자 키로 사용자 권한 검사를 우회하지 않습니다.

## 검증

`cd mobile && npm ci && npm run test:db`는 PGlite의 실제 PostgreSQL 엔진에 마이그레이션을 적용합니다. 테스트에서는 Supabase의 `auth.users`와 `auth.uid()` 계약을 재현하고 `anon`/`authenticated` 역할을 바꿔 사용자 간 읽기·수정·삭제 차단, 소유자 위조 차단, 메시지 소유권 FK, 게스트 가격 변경 차단 및 삭제 전파를 검증합니다. 원격 프로젝트의 JWT 발급·이메일 발송·설정과 실기기 Keychain/Keystore 동작까지 검증하는 테스트는 아닙니다.
