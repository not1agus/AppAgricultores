-- Structured phytosanitary record (cuaderno fitosanitario) per RD 1311/2012.
-- We store the regulated fields as a single jsonb blob on the actividad row
-- rather than a side table:
--   * one-to-one with the actividad, never queried independently
--   * shape is small and stable; field-level RLS isn't needed
--   * keeps the existing list/detail queries to a single round-trip
-- A CHECK constraint enforces that this block can only be set when the
-- actividad's `type` is the phytosanitary one — otherwise compliance data
-- would be silently attached to unrelated entries (riego, poda…).

alter table public.actividades
  add column fitosanitario jsonb;

alter table public.actividades
  add constraint actividades_fitosanitario_only_for_tratamiento
  check (
    fitosanitario is null
    or type = 'tratamiento_fitosanitario'
  );

-- Partial index: only the small subset of rows that actually carry a
-- fitosanitario block. Useful for compliance exports / agency reporting that
-- filter on `fitosanitario is not null`.
create index actividades_fitosanitario_present_idx
  on public.actividades (performed_at desc)
  where fitosanitario is not null;
