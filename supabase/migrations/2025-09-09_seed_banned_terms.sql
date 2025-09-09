-- 2025-09-09_seed_banned_terms.sql
-- Idempotent seed for public.banned_terms
-- NOTE: Patterns use case-insensitive (~*) matches. Adjust/expand as needed.

-- Ensure table exists (no-op if already created earlier)
CREATE TABLE IF NOT EXISTS public.banned_terms (
  term    text PRIMARY KEY,
  pattern text NOT NULL
);

-- Core profanity (whole-word matches)
INSERT INTO public.banned_terms (term, pattern) VALUES
  ('profanity_f_word',      '\yfuck\y'),
  ('profanity_s_word',      '\yshit\y'),
  ('profanity_b_word',      '\ybitch\y'),
  ('profanity_a_word',      '\yasshole\y'),
  ('profanity_d_word',      '\ydick\y'),
  ('profanity_bastard',     '\ybastard\y'),
  ('profanity_piss',        '\ypiss\y')
ON CONFLICT (term) DO UPDATE
SET pattern = EXCLUDED.pattern;

-- Simple obfuscation variants (allow non-letters between letters)
-- These are broader; keep them conservative to reduce false positives.
INSERT INTO public.banned_terms (term, pattern) VALUES
  ('profanity_f_word_variants', 'f[\W_]*u[\W_]*c[\W_]*k'),
  ('profanity_s_word_variants', 's[\W_]*h[\W_]*i[\W_]*t'),
  ('profanity_b_word_variants', 'b[\W_]*i[\W_]*t[\W_]*c[\W_]*h'),
  ('profanity_a_word_variants', 'a[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e')
ON CONFLICT (term) DO UPDATE
SET pattern = EXCLUDED.pattern;

-- Optional: mild language (uncomment if you want to block these too)
-- INSERT INTO public.banned_terms (term, pattern) VALUES
--   ('profanity_damn', '\ydamn\y')
-- ON CONFLICT (term) DO UPDATE SET pattern = EXCLUDED.pattern;

-- Quick self-check (optional): count current terms
-- SELECT count(*) AS banned_terms_loaded FROM public.banned_terms;
