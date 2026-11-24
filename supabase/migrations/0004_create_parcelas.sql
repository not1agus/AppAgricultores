-- Parcelas: cultivable plots inside a finca.
-- sigpac_ref and geometry are JSONB so the app can store references and
-- GeoJSON without requiring PostGIS on day one. If spatial queries are
-- needed later, a generated geometry(Geometry, 4326) column can be added.
create table public.parcelas (
  id uuid primary key default gen_random_uuid(),
  finca_id uuid not null references public.fincas(id) on delete cascade,
  name text not null,
  area_ha numeric(10, 4),
  sigpac_ref jsonb,
  geometry jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parcelas_finca_id_idx on public.parcelas (finca_id);

create trigger parcelas_set_updated_at
before update on public.parcelas
for each row execute function public.set_updated_at();

alter table public.parcelas enable row level security;

create policy parcelas_select_member
on public.parcelas for select
using (public.is_finca_member(finca_id));

create policy parcelas_insert_owner
on public.parcelas for insert
with check (public.is_finca_owner(finca_id));

create policy parcelas_update_owner
on public.parcelas for update
using (public.is_finca_owner(finca_id))
with check (public.is_finca_owner(finca_id));

create policy parcelas_delete_owner
on public.parcelas for delete
using (public.is_finca_owner(finca_id));
