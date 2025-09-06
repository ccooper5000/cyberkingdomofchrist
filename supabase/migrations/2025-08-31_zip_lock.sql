-- 1) Ensure exactly one primary address per user
CREATE UNIQUE INDEX IF NOT EXISTS user_primary_address_unique
ON public.user_addresses (user_id)
WHERE is_primary = true;

-- 2) Basic ZIP validation (US 5 or 9-digit ZIP)
ALTER TABLE public.user_addresses
ADD CONSTRAINT user_addresses_postal_code_format_chk
CHECK (
  country = 'US'
  AND postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
);

-- 3) RLS: allow users to read their own address; inserts allowed once; updates/deletes blocked
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

-- Clean up any permissive policies that might exist from earlier sessions
DROP POLICY IF EXISTS user_addresses_select_self ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_insert_self ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_update_self ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_delete_self ON public.user_addresses;

-- SELECT: user can read their own address
CREATE POLICY user_addresses_select_self
ON public.user_addresses FOR SELECT
USING (user_id = auth.uid());

-- INSERT: user can create exactly one primary US ZIP record for themselves
CREATE POLICY user_addresses_insert_self
ON public.user_addresses FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND is_primary = true
  AND country = 'US'
);

-- UPDATE/DELETE: intentionally NO policy for authenticated users => blocked.
-- (Service role / admin bypasses RLS, which is what we want for manual changes.)

-- 4) (Optional) Mild integrity helpers:
-- Force country to US on insert when omitted (clients should still send it)
-- NOTE: If you want this trigger, uncomment it. Otherwise ensure client sets country='US'.
-- CREATE OR REPLACE FUNCTION public.set_user_address_defaults()
-- RETURNS trigger AS $$
-- BEGIN
--   IF NEW.country IS NULL THEN NEW.country := 'US'; END IF;
--   RETURN NEW;
-- END; $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- DROP TRIGGER IF EXISTS trg_user_addresses_defaults ON public.user_addresses;
-- CREATE TRIGGER trg_user_addresses_defaults
-- BEFORE INSERT ON public.user_addresses
-- FOR EACH ROW EXECUTE FUNCTION public.set_user_address_defaults();
