-- Tickets: scanned almazara receipts. OCR runs in a backend sidecar
-- (PaddleOCR); parsed output is stored for auditing and the user can
-- correct values before promoting a ticket to a transaccion.
create type public.ticket_status as enum (
  'pending',     -- just created, OCR not yet attempted
  'processing',  -- OCR in flight
  'done',        -- OCR finished successfully
  'failed',      -- OCR failed; manual entry required
  'manual'       -- created without OCR (OCR service not configured or skipped)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  finca_id uuid not null references public.fincas(id) on delete cascade,
  campana_id uuid references public.campanas(id) on delete set null,
  transaccion_id uuid references public.transacciones(id) on delete set null,
  image_url text not null,
  status public.ticket_status not null default 'pending',
  ocr_engine text,
  ocr_raw_text text,
  ocr_confidence numeric(5, 4),
  -- Parsed output from the OCR engine (best-effort heuristic extraction).
  -- Shape: { almazara, fecha, kgAceituna, kgAceite, rendimientoPct,
  --          precioUnitarioEur, totalEur, currency }.
  parsed jsonb,
  -- User-corrected values, same shape as `parsed`. Authoritative when set.
  corrected jsonb,
  notes text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_image_url_nonempty check (length(btrim(image_url)) > 0),
  constraint tickets_confidence_range check (
    ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)
  )
);
create index tickets_finca_id_idx on public.tickets (finca_id);
create index tickets_campana_id_idx on public.tickets (campana_id);
create index tickets_transaccion_id_idx on public.tickets (transaccion_id);
create index tickets_status_idx on public.tickets (status);
create index tickets_created_at_idx on public.tickets (created_at desc);
create index tickets_created_by_idx on public.tickets (created_by);

create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

alter table public.tickets enable row level security;

create policy tickets_select_member
on public.tickets for select
using (public.is_finca_member(finca_id));

create policy tickets_insert_member
on public.tickets for insert
with check (
  public.is_finca_member(finca_id)
  and created_by = auth.uid()
);

-- Editing a ticket (e.g. corrections): the uploader or any finca owner.
create policy tickets_update_creator_or_owner
on public.tickets for update
using (
  created_by = auth.uid()
  or public.is_finca_owner(finca_id)
)
with check (
  created_by = auth.uid()
  or public.is_finca_owner(finca_id)
);

create policy tickets_delete_creator_or_owner
on public.tickets for delete
using (
  created_by = auth.uid()
  or public.is_finca_owner(finca_id)
);
