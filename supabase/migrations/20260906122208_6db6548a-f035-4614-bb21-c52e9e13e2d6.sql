-- 1. GitHub connections
CREATE TABLE public.github_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  account_login text NOT NULL DEFAULT '',
  repo_owner text NOT NULL DEFAULT '',
  repo_name text NOT NULL DEFAULT '',
  default_branch text NOT NULL DEFAULT 'main',
  has_token boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_connections TO authenticated;
GRANT ALL ON public.github_connections TO service_role;
ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own github connections" ON public.github_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())))
  WITH CHECK (auth.uid() = user_id AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())));
CREATE TRIGGER github_connections_touch BEFORE UPDATE ON public.github_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. GitHub tokens: service_role only, no RLS policies (mirrors provider_secrets)
CREATE TABLE public.github_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.github_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.github_secrets TO service_role;
ALTER TABLE public.github_secrets ENABLE ROW LEVEL SECURITY;

-- 3. Sensitive action approvals
CREATE TABLE public.action_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  result text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_approvals TO authenticated;
GRANT ALL ON public.action_approvals TO service_role;
ALTER TABLE public.action_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own action approvals" ON public.action_approvals FOR ALL TO authenticated
  USING (auth.uid() = user_id AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())))
  WITH CHECK (auth.uid() = user_id AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())));
CREATE TRIGGER action_approvals_touch BEFORE UPDATE ON public.action_approvals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Usage / observability events (no prompt text, no secrets)
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  request_id text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'model_call',
  provider_kind text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  agent_id text NOT NULL DEFAULT '',
  tools text[] NOT NULL DEFAULT '{}',
  latency_ms integer NOT NULL DEFAULT 0,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric,
  retries integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  verification text NOT NULL DEFAULT 'unverified',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own usage events" ON public.usage_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert own usage events" ON public.usage_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_usage_events_user_created ON public.usage_events(user_id, created_at DESC);
CREATE INDEX idx_github_connections_project ON public.github_connections(project_id);
CREATE INDEX idx_action_approvals_user_status ON public.action_approvals(user_id, status);