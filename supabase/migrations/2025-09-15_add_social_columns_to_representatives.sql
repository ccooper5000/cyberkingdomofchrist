-- Adds social link fields for representatives.
-- Safe to run multiple times; IF NOT EXISTS guards included.

ALTER TABLE public.representatives
  ADD COLUMN IF NOT EXISTS twitter_handle text,
  ADD COLUMN IF NOT EXISTS facebook_page_url text;

-- Optional hygiene: keep twitter_handle without a leading '@'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'representatives_twitter_handle_no_at'
  ) THEN
    ALTER TABLE public.representatives
      ADD CONSTRAINT representatives_twitter_handle_no_at
      CHECK (twitter_handle IS NULL OR position('@' IN twitter_handle) = 0);
  END IF;
END$$;
