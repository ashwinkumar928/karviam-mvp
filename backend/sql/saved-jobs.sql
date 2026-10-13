-- Run manually in Supabase SQL Editor. Never executed by the application.
BEGIN;

CREATE TABLE public.saved_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX saved_jobs_user_created_idx
  ON public.saved_jobs (user_id, created_at DESC, id DESC);
CREATE INDEX saved_jobs_job_idx ON public.saved_jobs (job_id);

-- Express verifies custom JWTs; browsers must not access this table directly.
-- As with the existing safety tables, the backend role must own it or have BYPASSRLS.
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_jobs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.saved_jobs_id_seq FROM anon, authenticated;

COMMIT;
