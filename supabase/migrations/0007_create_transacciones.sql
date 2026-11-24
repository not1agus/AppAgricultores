-- Transacciones: income (ingreso) and expense (gasto) entries aggregated
-- under a campaña. Categories are free-form text (e.g. "venta_cosecha",
-- "fertilizante", "combustible") so the catalogue can evolve without DDL.
create type public.transaccion_kind as enum ('ingreso', 'gasto');

create table public.transacciones (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.campanas(id) on delete cascade,
  kind public.transaccion_kind not null,
  category text not null,
  occurred_at date not null,
  amount_eur numeric(12, 2) not null,
  description text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transacciones_amount_nonneg check (amount_eur >= 0),
  constraint transacciones_category_nonempty check (length(btrim(category)) > 0)
);
create index transacciones_campana_id_idx on public.transacciones (campana_id);
create index transacciones_occurred_at_idx on public.transacciones (occurred_at desc);
create index transacciones_kind_idx on public.transacciones (kind);
create index transacciones_created_by_idx on public.transacciones (created_by);

create trigger transacciones_set_updated_at
before update on public.transacciones
for each row execute function public.set_updated_at();

-- Helper used by RLS policies to resolve a campaña's finca without
-- re-implementing the lookup in every policy.
create or replace function public.campana_finca_id(p_campana_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select finca_id from public.campanas where id = p_campana_id;
$$;

alter table public.transacciones enable row level security;

create policy transacciones_select_member
on public.transacciones for select
using (public.is_finca_member(public.campana_finca_id(campana_id)));

create policy transacciones_insert_member
on public.transacciones for insert
with check (
  public.is_finca_member(public.campana_finca_id(campana_id))
  and created_by = auth.uid()
);

create policy transacciones_update_creator_or_owner
on public.transacciones for update
using (
  created_by = auth.uid()
  or public.is_finca_owner(public.campana_finca_id(campana_id))
)
with check (
  created_by = auth.uid()
  or public.is_finca_owner(public.campana_finca_id(campana_id))
);

create policy transacciones_delete_creator_or_owner
on public.transacciones for delete
using (
  created_by = auth.uid()
  or public.is_finca_owner(public.campana_finca_id(campana_id))
);
