-- b-pipeline store (TRD §5.1). Differences from TRD are recorded in docs/decisions.md (K8).
-- sessions.state holds the baseline session state only; pipeline data
-- (recipientId, sensitivity, experiment, provenance) lives in sessions.meta.
create table if not exists recipients(
  id text primary key,
  owner_id text not null,
  name text not null,
  aliases text not null default '[]',          -- JSON: ["엄마","어머님"]
  group_name text,                             -- '부모님'
  budget_cap_krw integer check (budget_cap_krw is null or budget_cap_krw > 0), -- blocks "올리기" only
  price_sensitivity text not null default 'balanced' check (price_sensitivity in ('value','balanced','quality')),
  created_at text not null);
create index if not exists recipients_owner on recipients(owner_id);

create table if not exists memories(
  id text primary key,
  recipient_id text not null references recipients(id) on delete cascade,
  key text not null,                           -- memory/keys.mjs vocabulary
  polarity integer not null check (polarity in (1,-1)),
  strength real not null default 0.7 check (strength >= 0 and strength <= 1),
  status text not null check (status in ('confirmed','suggested')),
  source text not null check (source in ('explicit','feedback','purchase')),
  evidence text not null check (length(evidence) between 1 and 200), -- user's own sentence only
  signals text not null default '[]',          -- JSON: session ids of suggested-feedback signals (never in evidence)
  created_at text not null,
  last_used_at text);
create index if not exists memories_recipient on memories(recipient_id);

create table if not exists gift_history(
  id text primary key,
  recipient_id text not null references recipients(id) on delete cascade,
  product_id text not null,
  occasion text,
  given_at text,
  satisfaction integer check (satisfaction is null or satisfaction between 1 and 5));
create index if not exists gift_history_recipient on gift_history(recipient_id);

create table if not exists sessions(
  id text primary key,
  owner_id text not null,
  version integer not null check (version >= 0),
  state text not null,                         -- baseline session state JSON (validateState)
  meta text not null default '{}',             -- {recipientId, sensitivity, experiment, provenance}
  updated_at text not null);

create table if not exists events(              -- experiment log; never stores raw utterances
  id integer primary key,
  session_id text,
  type text not null,
  payload text not null default '{}',
  at text not null);
create index if not exists events_session on events(session_id);
