/**
 * GitHub REST helpers. Server-only: the personal access token lives in
 * public.github_secrets, which has no RLS policies and is reachable by the
 * service role only, so the browser can never read it.
 */

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type GitHubConnection = {
  id: string;
  userId: string;
  accountLogin: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  token: string;
};

/** Loads a connection the caller owns, together with its stored token. */
export async function loadConnection(
  connectionId: string,
  userId: string,
): Promise<GitHubConnection> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("github_connections")
    .select("id, user_id, account_login, repo_owner, repo_name, default_branch")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new GitHubError(error.message, 500);
  if (!data) throw new GitHubError("GitHub connection not found.", 404);

  const { data: secret, error: secretError } = await supabaseAdmin
    .from("github_secrets")
    .select("token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (secretError) throw new GitHubError(secretError.message, 500);
  if (!secret?.token) {
    throw new GitHubError(
      "No GitHub access token is stored for this connection. Reconnect with a token.",
      401,
    );
  }

  return {
    id: data.id,
    userId: data.user_id,
    accountLogin: data.account_login,
    repoOwner: data.repo_owner,
    repoName: data.repo_name,
    defaultBranch: data.default_branch,
    token: secret.token,
  };
}

export async function gh<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "User-Agent": "rupesh-llm-studio",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = `GitHub returned ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) message = `${parsed.message} (GitHub ${response.status})`;
    } catch {
      if (text) message = `${text.slice(0, 300)} (GitHub ${response.status})`;
    }
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      message = "GitHub rate limit reached for this token. Wait for it to reset and retry.";
    }
    throw new GitHubError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Verifies that a sensitive action was explicitly approved by the owner,
 * then marks the approval consumed so it cannot be replayed.
 */
export async function consumeApproval(args: {
  approvalId: string;
  userId: string;
  action: string;
  target: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("action_approvals")
    .select("id, action, target, status")
    .eq("id", args.approvalId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new GitHubError(error.message, 500);
  if (!data) throw new GitHubError("No approval record found for this action.", 403);
  if (data.status !== "approved") {
    throw new GitHubError(
      `This action is still ${data.status}. Approve it first — nothing was sent to GitHub.`,
      403,
    );
  }
  if (data.action !== args.action || data.target !== args.target) {
    throw new GitHubError(
      "The approval does not match this action or target. Nothing was sent to GitHub.",
      403,
    );
  }
  const { error: updateError } = await supabaseAdmin
    .from("action_approvals")
    .update({ status: "executed", decided_at: new Date().toISOString() })
    .eq("id", args.approvalId)
    .eq("status", "approved");
  if (updateError) throw new GitHubError(updateError.message, 500);
}
