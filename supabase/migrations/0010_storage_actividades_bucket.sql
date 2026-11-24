-- Storage bucket for actividad photos (cuaderno de campo).
--
-- These are "before/after" shots of treatments, pruning, harvesting, etc.
-- Public read so `<Image source={{ uri }} />` in the app can fetch them
-- without juggling signed URLs. If we later decide the photos are sensitive
-- (e.g. showing farm location), swap to signed URLs from the backend and
-- drop the public_read policy below.
insert into storage.buckets (id, name, public)
values ('actividades', 'actividades', true)
on conflict (id) do nothing;

-- Per-user folder isolation: an authenticated user can only touch objects
-- under "<auth.uid()>/...". Mirrors the tickets bucket policy from
-- 0009_storage_tickets_bucket.sql.
create policy "actividades_upload_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'actividades'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "actividades_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'actividades'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'actividades'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "actividades_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'actividades'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "actividades_public_read"
on storage.objects for select
to public
using (bucket_id = 'actividades');
