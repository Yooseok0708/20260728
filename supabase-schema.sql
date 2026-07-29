create extension if not exists pgcrypto;

create table if not exists public.lottery_draws (
  id uuid primary key default gen_random_uuid(),
  birthday date not null,
  sign_name text not null,
  sign_element text not null,
  sign_trait text not null,
  sign_vibe text not null,
  main_numbers integer[] not null,
  bonus_number integer not null,
  explanation text not null,
  source text not null default 'openai',
  created_at timestamptz not null default now()
);

alter table public.lottery_draws enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lottery_draws'
      and policyname = 'Allow insert for anon'
  ) then
    create policy "Allow insert for anon"
    on public.lottery_draws
    for insert
    to anon
    with check (true);
  end if;
end $$;

create index if not exists lottery_draws_created_at_idx
  on public.lottery_draws (created_at desc);

create index if not exists lottery_draws_birthday_idx
  on public.lottery_draws (birthday);
