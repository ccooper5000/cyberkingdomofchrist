-- Representatives: allow reads to all authed users (safe public data)
ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS representatives_select_all ON public.representatives;
CREATE POLICY representatives_select_all
ON public.representatives FOR SELECT
USING (true);

-- User <-> Representative mapping: user can read/insert only their own rows
ALTER TABLE public.user_representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_reps_select_self ON public.user_representatives;
DROP POLICY IF EXISTS user_reps_insert_self ON public.user_representatives;

CREATE POLICY user_reps_select_self
ON public.user_representatives FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY user_reps_insert_self
ON public.user_representatives FOR INSERT
WITH CHECK (user_id = auth.uid());

-- De-dupe safety: one mapping per (user,rep)
CREATE UNIQUE INDEX IF NOT EXISTS user_reps_unique
ON public.user_representatives (user_id, rep_id);
