-- Fincas: the farms. Each row has a designated "owner_id" for convenience,
-- but access control is driven by finca_members so cooperativas with
-- multiple owners/workers are representable.
create table public.fincas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fincas_owner_id_idx on public.fincas (owner_id);

create trigger fincas_set_updated_at
before update on public.fincas
for each row execute function public.set_updated_at();

create type public.finca_member_role as enum ('owner', 'worker');

create table public.finca_members (
  finca_id uuid not null references public.fincas(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_in_finca public.finca_member_role not null,
  created_at timestamptz not null default now(),
  primary key (finca_id, user_id)
);
create index finca_members_user_id_idx on public.finca_members (user_id);

-- Helper predicates used by RLS on fincas, parcelas, and future
-- finca-scoped tables. security definer so they can evaluate under
-- RLS without recursion.
create or replace function public.is_finca_member(p_finca_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.finca_members
    where finca_id = p_finca_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_finca_owner(p_finca_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.finca_members
    where finca_id = p_finca_id
      and user_id = auth.uid()
      and role_in_finca = 'owner'
  );
$$;

-- Atomic creation of a finca together with its owner membership.
-- Called via supabase.rpc so the two inserts run in one transaction.
create or replace function public.create_finca_with_owner(
  p_owner_id uuid,
  p_name text
)
returns public.fincas
language plpgsql
security definer
set search_path = public
as $$
declare
  new_finca public.fincas;
begin
  insert into public.fincas (owner_id, name)
  values (p_owner_id, p_name)
  returning * into new_finca;

  insert into public.finca_members (finca_id, user_id, role_in_finca)
  values (new_finca.id, p_owner_id, 'owner');

  return new_finca;
end;
$$;

alter table public.fincas enable row level security;

create policy fincas_select_member
on public.fincas for select
using (public.is_finca_member(id));

create policy fincas_update_owner
on public.fincas for update
using (public.is_finca_owner(id))
with check (public.is_finca_owner(id));

create policy fincas_delete_owner
on public.fincas for delete
using (public.is_finca_owner(id));

-- Inserts into fincas go through the RPC or the service-role key.

alter table public.finca_members enable row level security;

create policy finca_members_select_self_or_owner
on public.finca_members for select
using (user_id = auth.uid() or public.is_finca_owner(finca_id));

-- Membership mutations go through the service-role key only.
