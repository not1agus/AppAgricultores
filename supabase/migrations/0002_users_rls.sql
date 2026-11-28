alter table public.users enable row level security;

-- A user can read their own row.
create policy users_select_self
on public.users
for select
using (auth.uid() = id);

-- A user can update their own row, but never change role or block status
-- (those can only be changed by the backend using the service-role key,
-- which bypasses RLS).
create policy users_update_self
on public.users
for update
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = (select u.role from public.users u where u.id = auth.uid())
  and is_blocked = (select u.is_blocked from public.users u where u.id = auth.uid())
);

-- Inserts/deletes on public.users go through the trigger or the service role;
-- no client-side policies are granted.
