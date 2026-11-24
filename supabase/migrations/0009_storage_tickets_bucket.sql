-- Storage bucket for ticket images (almazara receipts).
--
-- Public read is required so the OCR sidecar (PaddleOCR) can fetch the
-- image by URL without juggling signed URLs in the request body. The
-- images are not PII; if we tighten this later, swap to signed URLs in
-- backend/src/modules/tickets/tickets.service.ts and remove the public
-- read policy here.
insert into storage.buckets (id, name, public)
values ('tickets', 'tickets', true)
on conflict (id) do nothing;

-- Authenticated users can upload to the tickets bucket. We scope writes
-- to a per-user folder ("<user_id>/...") so one user can never overwrite
-- another's object even with a guessed path.
create policy "tickets_upload_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tickets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "tickets_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'tickets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'tickets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "tickets_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tickets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read so the OCR sidecar can GET the image. (Bucket is already
-- marked public; this policy is explicit for clarity if the default
-- changes.)
create policy "tickets_public_read"
on storage.objects for select
to public
using (bucket_id = 'tickets');
