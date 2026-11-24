-- Campañas: harvest/season periods used to aggregate income and expenses.
create table public.campanas (
  id uuid primary key default gen_random_uuid(),
  finca_id uuid not null references public.fincas(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campanas_period_valid check (end_date >= start_date)
);
create unique index campanas_finca_name_uq on public.campanas (finca_id, name);
create index campanas_finca_id_idx on public.campanas (finca_id);
create index campanas_start_date_idx on public.campanas (start_date);

create trigger campanas_set_updated_at
before update on public.campanas
for each row execute function public.set_updated_at();

alter table public.campanas enable row level security;

create policy campanas_select_member
on public.campanas for select
using (public.is_finca_member(finca_id));

create policy campanas_insert_owner
on public.campanas for insert
with check (public.is_finca_owner(finca_id));

create policy campanas_update_owner
on public.campanas for update
using (public.is_finca_owner(finca_id))
with check (public.is_finca_owner(finca_id));

create policy campanas_delete_owner
on public.campanas for delete
using (public.is_finca_owner(finca_id));
