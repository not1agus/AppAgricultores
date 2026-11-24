-- Activities (cuaderno de campo): one row per field event tied to a parcela.
create type public.actividad_type as enum (
  'tratamiento_fitosanitario',
  'riego',
  'poda',
  'cosecha',
  'abonado',
  'siembra',
  'laboreo',
  'otro'
);

create table public.actividades (
  id uuid primary key default gen_random_uuid(),
  parcela_id uuid not null references public.parcelas(id) on delete cascade,
  type public.actividad_type not null,
  performed_at date not null,
  description text,
  cost_eur numeric(12, 2),
  photos jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index actividades_parcela_id_idx on public.actividades (parcela_id);
create index actividades_performed_at_idx on public.actividades (performed_at desc);
create index actividades_created_by_idx on public.actividades (created_by);

create trigger actividades_set_updated_at
before update on public.actividades
for each row execute function public.set_updated_at();

-- Helper used by RLS policies to resolve a parcela's finca without
-- re-implementing the lookup in every policy.
create or replace function public.parcela_finca_id(p_parcela_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select finca_id from public.parcelas where id = p_parcela_id;
$$;

alter table public.actividades enable row level security;

create policy actividades_select_member
on public.actividades for select
using (public.is_finca_member(public.parcela_finca_id(parcela_id)));

create policy actividades_insert_member
on public.actividades for insert
with check (
  public.is_finca_member(public.parcela_finca_id(parcela_id))
  and created_by = auth.uid()
);

-- Editing a logbook entry: the worker who wrote it, or any finca owner.
create policy actividades_update_creator_or_owner
on public.actividades for update
using (
  created_by = auth.uid()
  or public.is_finca_owner(public.parcela_finca_id(parcela_id))
)
with check (
  created_by = auth.uid()
  or public.is_finca_owner(public.parcela_finca_id(parcela_id))
);

create policy actividades_delete_creator_or_owner
on public.actividades for delete
using (
  created_by = auth.uid()
  or public.is_finca_owner(public.parcela_finca_id(parcela_id))
);
