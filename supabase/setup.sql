-- 대성중학교 수업 도구 나눔터 · Supabase 설치 스크립트
--
-- 쓰는 법: Supabase 대시보드 > SQL Editor에 이 파일 내용을 통째로 붙여 넣고 Run.
--         여러 번 실행해도 됩니다(이미 있는 자료는 지워지지 않습니다).
--         실행한 뒤에는 관리자 비밀번호와 가입 코드를 정해야 합니다(docs/서버-설치.md 3단계).
--
-- 구조: 표(table)는 바깥에서 직접 읽거나 쓸 수 없게 모두 잠그고,
--       사이트는 아래의 함수만 부릅니다. 비밀번호 확인과 권한 검사는 전부 이 함수들 안에서 합니다.

create extension if not exists pgcrypto with schema extensions;

/* ---------- 표 ---------- */
create table if not exists public.settings (
  key   text primary key,          -- 'admin_hash', 'signup_code_hash'
  value text not null
);
create table if not exists public.teachers (
  name       text primary key,     -- 관리자가 등록한 성함
  pw_hash    text,                 -- 비어 있으면 아직 첫 로그인 전
  created_at timestamptz not null default now()
);
create table if not exists public.sessions (
  token_hash text primary key,     -- 로그인 표(token)는 변환해서만 보관
  name       text references public.teachers(name) on delete cascade,
  is_admin   boolean not null default false,
  expires_at timestamptz not null
);
create table if not exists public.throttle (
  key          text primary key,   -- 비밀번호를 여러 번 틀리면 잠시 잠급니다
  fails        int not null default 0,
  locked_until timestamptz
);
create table if not exists public.tools (
  id         text primary key,
  title      text not null,
  summary    text not null,
  subject    text not null,
  grade      text not null default '전 학년',
  intent     text not null,
  howto      text not null default '',
  kind       text not null check (kind in ('html', 'link')),
  url        text,
  html       text,
  thumb      text,
  author     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create table if not exists public.likes (
  tool_id text not null references public.tools(id) on delete cascade,
  voter   text not null,           -- 브라우저마다 하나씩 갖는 임의의 번호
  primary key (tool_id, voter)
);
create table if not exists public.feedback (
  id         text primary key,
  tool_id    text not null references public.tools(id) on delete cascade,
  body       text not null,
  from_name  text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.reports (
  id         text primary key,
  tool_id    text not null references public.tools(id) on delete cascade,
  body       text not null,
  from_name  text not null,
  created_at timestamptz not null default now()
);

-- 표는 모두 잠급니다. 허용 규칙(policy)을 하나도 두지 않으므로 함수를 거치지 않고는 접근할 수 없습니다.
alter table public.settings enable row level security;
alter table public.teachers enable row level security;
alter table public.sessions enable row level security;
alter table public.throttle enable row level security;
alter table public.tools    enable row level security;
alter table public.likes    enable row level security;
alter table public.feedback enable row level security;
alter table public.reports  enable row level security;
revoke all on public.settings, public.teachers, public.sessions, public.throttle,
              public.tools, public.likes, public.feedback, public.reports
  from anon, authenticated;

/* ---------- 안에서만 쓰는 함수 (이름이 _로 시작) ---------- */
create or replace function public._new_id() returns text
language sql volatile as $$ select replace(gen_random_uuid()::text, '-', '') $$;

create or replace function public._hash_token(p text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

-- 로그인 표로 선생님 성함을 찾습니다. 없거나 기한이 지났으면 null
create or replace function public._who(p_token text) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select name from sessions
  where token_hash = _hash_token(p_token) and not is_admin and expires_at > now()
$$;

create or replace function public._is_admin(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from sessions
                 where token_hash = _hash_token(p_token) and is_admin and expires_at > now())
$$;

create or replace function public._open_session(p_name text, p_admin boolean) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  t text := _new_id() || _new_id();
begin
  delete from sessions where expires_at < now();
  insert into sessions (token_hash, name, is_admin, expires_at)
  values (_hash_token(t), p_name, p_admin,
          now() + case when p_admin then interval '12 hours' else interval '180 days' end);
  return t;
end $$;

create or replace function public._locked(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from throttle where key = p_key and locked_until > now())
$$;

-- 다섯 번 틀리면 5분 동안 잠급니다.
create or replace function public._fail(p_key text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into throttle (key, fails) values (p_key, 1)
  on conflict (key) do update set fails = throttle.fails + 1;
  update throttle set fails = 0, locked_until = now() + interval '5 minutes'
  where key = p_key and fails >= 5;
end $$;

create or replace function public._check_tool(p jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(char_length(trim(p->>'title')), 0) not between 1 and 40 then raise exception 'invalid title'; end if;
  if coalesce(char_length(trim(p->>'summary')), 0) not between 1 and 60 then raise exception 'invalid summary'; end if;
  if coalesce(char_length(trim(p->>'subject')), 0) not between 1 and 20 then raise exception 'invalid subject'; end if;
  if coalesce(char_length(trim(p->>'intent')), 0) not between 1 and 600 then raise exception 'invalid intent'; end if;
  if coalesce(char_length(p->>'howto'), 0) > 600 then raise exception 'invalid howto'; end if;
  if coalesce(char_length(p->>'grade'), 0) > 10 then raise exception 'invalid grade'; end if;
  if p->>'kind' = 'html' then
    -- 화면의 제한은 900KB. 글자 변환으로 조금 늘 수 있어 여유를 둡니다.
    if coalesce(octet_length(p->>'html'), 0) not between 1 and 1000000 then raise exception 'invalid html'; end if;
  elsif p->>'kind' = 'link' then
    if coalesce(p->>'url', '') !~* '^https?://\S+$' or char_length(p->>'url') > 2000 then raise exception 'invalid url'; end if;
  else
    raise exception 'invalid kind';
  end if;
  if p->>'thumb' is not null
     and (p->>'thumb' not like 'data:image/%' or octet_length(p->>'thumb') > 400000) then
    raise exception 'invalid thumb';
  end if;
end $$;

/* ---------- 로그인 ---------- */
-- 'unknown'(등록되지 않은 성함) | 'new'(아직 비밀번호를 정하지 않음) | 'active'
create or replace function public.account_state(p_name text) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce((select case when pw_hash is null then 'new' else 'active' end
                   from teachers where name = p_name), 'unknown')
$$;

-- 첫 로그인: 가입 코드를 확인하고 개인 비밀번호를 정합니다.
-- result: 'ok'(token 포함) | 'code' | 'short' | 'state' | 'locked'
create or replace function public.register(p_name text, p_code text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  k text := 'reg:' || p_name;
  code_hash text;
begin
  if account_state(p_name) <> 'new' then return json_build_object('result', 'state'); end if;
  if _locked(k) then return json_build_object('result', 'locked'); end if;
  select value into code_hash from settings where key = 'signup_code_hash';
  if code_hash is null or crypt(coalesce(p_code, ''), code_hash) <> code_hash then
    perform _fail(k);
    return json_build_object('result', 'code');
  end if;
  if coalesce(char_length(p_password), 0) not between 6 and 200 then
    return json_build_object('result', 'short');
  end if;
  update teachers set pw_hash = crypt(p_password, gen_salt('bf', 10)) where name = p_name;
  delete from throttle where key = k;
  return json_build_object('result', 'ok', 'token', _open_session(p_name, false));
end $$;

-- result: 'ok'(token 포함) | 'password' | 'locked'
create or replace function public.login(p_name text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  k text := 'login:' || p_name;
  h text;
begin
  select pw_hash into h from teachers where name = p_name;
  if h is null then return json_build_object('result', 'password'); end if;
  if _locked(k) then return json_build_object('result', 'locked'); end if;
  if crypt(coalesce(p_password, ''), h) <> h then
    perform _fail(k);
    return json_build_object('result', 'password');
  end if;
  delete from throttle where key = k;
  return json_build_object('result', 'ok', 'token', _open_session(p_name, false));
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from sessions where token_hash = _hash_token(p_token)
$$;

/* ---------- 관리자 ---------- */
-- 관리자 비밀번호와 가입 코드를 정하거나 바꿉니다. SQL Editor에서만 실행할 수 있습니다(사이트에서는 못 부름).
--   select public.admin_setup('관리자 비밀번호', '가입 코드');
create or replace function public.admin_setup(p_admin_password text, p_signup_code text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if coalesce(char_length(p_admin_password), 0) < 8 then raise exception '관리자 비밀번호는 8자 이상으로 정해 주세요.'; end if;
  if coalesce(char_length(p_signup_code), 0) < 6 then raise exception '가입 코드는 6자 이상으로 정해 주세요.'; end if;
  insert into settings (key, value) values ('admin_hash', crypt(p_admin_password, gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('signup_code_hash', crypt(p_signup_code, gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value;
  delete from sessions where is_admin;
  delete from throttle where key = 'admin';
  return '관리자 비밀번호와 가입 코드를 저장했습니다.';
end $$;

-- result: 'ok'(token 포함) | 'password' | 'locked'
create or replace function public.admin_login(p_password text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  h text;
begin
  if _locked('admin') then return json_build_object('result', 'locked'); end if;
  select value into h from settings where key = 'admin_hash';
  if h is null or crypt(coalesce(p_password, ''), h) <> h then
    perform _fail('admin');
    return json_build_object('result', 'password');
  end if;
  delete from throttle where key = 'admin';
  return json_build_object('result', 'ok', 'token', _open_session(null, true));
end $$;

-- [{ name, active }] — active는 비밀번호를 정했는지
create or replace function public.list_accounts(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not _is_admin(p_token) then raise exception 'auth'; end if;
  return coalesce((select json_agg(json_build_object('name', name, 'active', pw_hash is not null) order by name)
                   from teachers), '[]'::json);
end $$;

-- 명단을 통째로 바꿉니다. 명단에서 빠진 선생님은 비밀번호와 로그인도 함께 지워집니다(올린 도구는 남음).
create or replace function public.set_teachers(p_token text, p_names text[]) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  cleaned text[];
begin
  if not _is_admin(p_token) then raise exception 'auth'; end if;
  select coalesce(array_agg(distinct trim(n)), '{}') into cleaned
  from unnest(coalesce(p_names, '{}')) n
  where char_length(trim(n)) between 1 and 20;
  delete from teachers where name <> all (cleaned);
  insert into teachers (name) select unnest(cleaned) on conflict (name) do nothing;
  return true;
end $$;

-- 비밀번호를 잊은 선생님: 초기화하면 가입 코드로 다시 정할 수 있습니다.
create or replace function public.reset_password(p_token text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not _is_admin(p_token) then raise exception 'auth'; end if;
  update teachers set pw_hash = null where name = p_name;
  delete from sessions where name = p_name;
  delete from throttle where key in ('login:' || p_name, 'reg:' || p_name);
end $$;

/* ---------- 도구 ---------- */
-- 목록에는 HTML 본문을 싣지 않습니다(용량). 본문은 get_tool로 하나씩 받습니다.
create or replace function public.list_tools() returns json
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(json_agg(x order by x."createdAt" desc), '[]'::json)
  from (select t.id, t.title, t.summary, t.subject, t.grade, t.intent, t.howto, t.kind, t.url, t.thumb, t.author,
               t.created_at as "createdAt", t.updated_at as "updatedAt",
               (select count(*) from likes l where l.tool_id = t.id) as likes
        from tools t) x
$$;

create or replace function public.get_tool(p_id text) returns json
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select row_to_json(x)
  from (select t.id, t.title, t.summary, t.subject, t.grade, t.intent, t.howto, t.kind, t.url, t.html, t.thumb, t.author,
               t.created_at as "createdAt", t.updated_at as "updatedAt",
               (select count(*) from likes l where l.tool_id = t.id) as likes
        from tools t where t.id = p_id) x
$$;

-- 새 도구의 id를 돌려줍니다. 만든 사람은 로그인한 성함으로 자동 기록됩니다.
create or replace function public.add_tool(p_token text, p_data jsonb) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  who text := _who(p_token);
  new_id text := _new_id();
begin
  if who is null then raise exception 'auth'; end if;
  perform _check_tool(p_data);
  insert into tools (id, title, summary, subject, grade, intent, howto, kind, url, html, thumb, author)
  values (new_id, trim(p_data->>'title'), trim(p_data->>'summary'), trim(p_data->>'subject'),
          coalesce(nullif(p_data->>'grade', ''), '전 학년'), trim(p_data->>'intent'), coalesce(trim(p_data->>'howto'), ''),
          p_data->>'kind',
          case when p_data->>'kind' = 'link' then p_data->>'url' end,
          case when p_data->>'kind' = 'html' then p_data->>'html' end,
          p_data->>'thumb', who);
  return new_id;
end $$;

-- 올린 본인(p_token) 또는 관리자(p_admin_token)가 고칠 수 있습니다.
-- 만든 사람·올린 날·좋아요는 그대로 두고 고친 날을 남깁니다(관리자가 고쳐도 만든 사람은 바뀌지 않음).
drop function if exists public.update_tool(text, text, jsonb); -- 예전 모양(관리자 인자 없음)을 치웁니다
create or replace function public.update_tool(p_token text, p_id text, p_data jsonb, p_admin_token text default null) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  as_admin boolean := _is_admin(p_admin_token);
  who text := _who(p_token);
begin
  if not as_admin and who is null then raise exception 'auth'; end if;
  perform _check_tool(p_data);
  update tools set
    title = trim(p_data->>'title'), summary = trim(p_data->>'summary'), subject = trim(p_data->>'subject'),
    grade = coalesce(nullif(p_data->>'grade', ''), '전 학년'), intent = trim(p_data->>'intent'),
    howto = coalesce(trim(p_data->>'howto'), ''), kind = p_data->>'kind',
    url = case when p_data->>'kind' = 'link' then p_data->>'url' end,
    html = case when p_data->>'kind' = 'html' then p_data->>'html' end,
    thumb = p_data->>'thumb', updated_at = now()
  where id = p_id and (as_admin or author = who);
  return found;
end $$;

-- 올린 본인(p_token) 또는 관리자(p_admin_token)가 지울 수 있습니다. 의견·신고·좋아요도 함께 지워집니다.
create or replace function public.delete_tool(p_token text, p_id text, p_admin_token text default null) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if _is_admin(p_admin_token) then
    delete from tools where id = p_id;
  else
    delete from tools where id = p_id and author = _who(p_token);
  end if;
  return found;
end $$;

/* ---------- 좋아요 (로그인 없이, 브라우저마다 한 번) ---------- */
create or replace function public.is_liked(p_voter text, p_id text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from likes where tool_id = p_id and voter = p_voter)
$$;

-- 누른 뒤의 상태(true = 좋아요 켜짐)를 돌려줍니다.
create or replace function public.toggle_like(p_voter text, p_id text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if coalesce(char_length(p_voter), 0) not between 16 and 64 then raise exception 'invalid voter'; end if;
  delete from likes where tool_id = p_id and voter = p_voter;
  if found then return false; end if;
  insert into likes (tool_id, voter) values (p_id, p_voter);
  return true;
end $$;

/* ---------- 의견 (제작자만 읽음) ---------- */
create or replace function public.add_feedback(p_token text, p_tool text, p_text text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  who text := _who(p_token);
begin
  if who is null then raise exception 'auth'; end if;
  if coalesce(char_length(trim(p_text)), 0) not between 1 and 1000 then raise exception 'invalid text'; end if;
  insert into feedback (id, tool_id, body, from_name) values (_new_id(), p_tool, trim(p_text), who);
  return true;
end $$;

create or replace function public.list_feedback(p_token text, p_tool text) returns json
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'toolId', f.tool_id, 'text', f.body,
                                             'from', f.from_name, 'createdAt', f.created_at)
                           order by f.created_at desc), '[]'::json)
  from feedback f join tools t on t.id = f.tool_id
  where f.tool_id = p_tool and t.author = _who(p_token)
$$;

/* ---------- 신고 (관리자만 읽음) ---------- */
create or replace function public.add_report(p_token text, p_tool text, p_text text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  who text := _who(p_token);
begin
  if who is null then raise exception 'auth'; end if;
  if coalesce(char_length(trim(p_text)), 0) not between 1 and 1000 then raise exception 'invalid text'; end if;
  insert into reports (id, tool_id, body, from_name) values (_new_id(), p_tool, trim(p_text), who);
  return true;
end $$;

create or replace function public.list_reports(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not _is_admin(p_token) then raise exception 'auth'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'toolId', tool_id, 'text', body,
                                                     'from', from_name, 'createdAt', created_at)
                                   order by created_at desc)
                   from reports), '[]'::json);
end $$;

create or replace function public.dismiss_report(p_token text, p_id text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not _is_admin(p_token) then raise exception 'auth'; end if;
  delete from reports where id = p_id;
  return found;
end $$;

/* ---------- 누가 어떤 함수를 부를 수 있는지 ---------- */
-- 사이트(로그인하지 않은 방문자 포함)는 아래 목록의 함수만 부를 수 있습니다.
-- _로 시작하는 함수와 admin_setup은 사이트에서 부를 수 없습니다.
do $$
declare
  f regprocedure;
  open_names text[] := array[
    'account_state', 'register', 'login', 'logout', 'admin_login',
    'list_accounts', 'set_teachers', 'reset_password',
    'list_tools', 'get_tool', 'add_tool', 'update_tool', 'delete_tool',
    'is_liked', 'toggle_like', 'add_feedback', 'list_feedback',
    'add_report', 'list_reports', 'dismiss_report'];
  closed_names text[] := array[
    '_new_id', '_hash_token', '_who', '_is_admin', '_open_session', '_locked', '_fail', '_check_tool', 'admin_setup'];
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = any (open_names || closed_names) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = any (open_names) loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
