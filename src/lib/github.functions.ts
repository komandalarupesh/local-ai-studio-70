import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ConnectInput = z.object({
  token: z.string().min(10).max(500),
  projectId: z.string().uuid().optional(),
});

const ConnectionInput = z.object({ connectionId: z.string().uuid() });

const SelectRepoInput = z.object({
  connectionId: z.string().uuid(),
  owner: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
});

const CompareInput = z.object({
  connectionId: z.string().uuid(),
  base: z.string().min(1).max(250),
  head: z.string().min(1).max(250),
});

const CommitInput = z.object({
  connectionId: z.string().uuid(),
  approvalId: z.string().uuid(),
  branch: z.string().min(1).max(250),
  message: z.string().min(1).max(2000),
  files: z
    .array(z.object({ path: z.string().min(1).max(400), content: z.string().max(400_000) }))
    .min(1)
    .max(50),
});

const PullRequestInput = z.object({
  connectionId: z.string().uuid(),
  approvalId: z.string().uuid(),
  base: z.string().min(1).max(250),
  head: z.string().min(1).max(250),
  title: z.string().min(1).max(300),
  body: z.string().max(20_000).default(""),
});

function fail(error: unknown) {
  return {
    ok: false as const,
    message: error instanceof Error ? error.message : "The GitHub request failed.",
  };
}

/**
 * Stores a personal access token server-side and verifies it against GitHub.
 * The token is written to github_secrets (service-role only) and never returned.
 */
export const connectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, GitHubError } = await import("./github.server");
    try {
      const token = data.token.trim();
      const user = await gh<{ login: string }>(token, "/user");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing } = await supabaseAdmin
        .from("github_connections")
        .select("id")
        .eq("user_id", context.userId)
        .eq("account_login", user.login)
        .maybeSingle();

      let connectionId = existing?.id;
      if (!connectionId) {
        const { data: created, error } = await supabaseAdmin
          .from("github_connections")
          .insert({
            user_id: context.userId,
            project_id: data.projectId ?? null,
            account_login: user.login,
            has_token: true,
          })
          .select("id")
          .single();
        if (error) throw new GitHubError(error.message, 500);
        connectionId = created.id;
      } else {
        await supabaseAdmin
          .from("github_connections")
          .update({ has_token: true, ...(data.projectId ? { project_id: data.projectId } : {}) })
          .eq("id", connectionId);
      }

      const { error: secretError } = await supabaseAdmin
        .from("github_secrets")
        .upsert({ connection_id: connectionId, user_id: context.userId, token });
      if (secretError) throw new GitHubError(secretError.message, 500);

      return { ok: true as const, connectionId, login: user.login };
    } catch (error) {
      return fail(error);
    }
  });

/** Removes the stored token and the connection row. Repository data is untouched. */
export const disconnectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("github_secrets").delete().eq("connection_id", data.connectionId);
    const { error } = await supabaseAdmin
      .from("github_connections")
      .delete()
      .eq("id", data.connectionId)
      .eq("user_id", context.userId);
    if (error) return fail(new Error(error.message));
    return { ok: true as const };
  });

/** Repositories the token can actually see. Nothing is invented. */
export const listGitHubRepos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      const repos = await gh<
        {
          full_name: string;
          name: string;
          owner: { login: string };
          private: boolean;
          default_branch: string;
          updated_at: string;
        }[]
      >(conn.token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator");
      return {
        ok: true as const,
        repos: repos.map((r) => ({
          fullName: r.full_name,
          owner: r.owner.login,
          name: r.name,
          private: r.private,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
        })),
      };
    } catch (error) {
      return fail(error);
    }
  });

/** Links the connection to one repository (read-only bookkeeping). */
export const selectGitHubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SelectRepoInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      const repo = await gh<{ default_branch: string }>(
        conn.token,
        `/repos/${data.owner}/${data.name}`,
      );
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("github_connections")
        .update({
          repo_owner: data.owner,
          repo_name: data.name,
          default_branch: repo.default_branch,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", data.connectionId)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { ok: true as const, defaultBranch: repo.default_branch };
    } catch (error) {
      return fail(error);
    }
  });

/** Branches, recent commits, open PRs/issues and CI status for the linked repo. */
export const getRepoOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      if (!conn.repoOwner || !conn.repoName) {
        return { ok: false as const, message: "Pick a repository for this connection first." };
      }
      const base = `/repos/${conn.repoOwner}/${conn.repoName}`;

      const [branches, commits, pulls, issues] = await Promise.all([
        gh<{ name: string; commit: { sha: string } }[]>(conn.token, `${base}/branches?per_page=50`),
        gh<
          {
            sha: string;
            commit: { message: string; author: { name: string; date: string } };
            html_url: string;
          }[]
        >(conn.token, `${base}/commits?per_page=20`),
        gh<
          {
            number: number;
            title: string;
            state: string;
            html_url: string;
            head: { ref: string };
            base: { ref: string };
            draft: boolean;
          }[]
        >(conn.token, `${base}/pulls?state=open&per_page=20`),
        gh<{ number: number; title: string; html_url: string; pull_request?: unknown }[]>(
          conn.token,
          `${base}/issues?state=open&per_page=20`,
        ),
      ]);

      const headSha = commits[0]?.sha;
      let checks: { name: string; status: string; conclusion: string; url: string }[] = [];
      let checksNote = "";
      if (headSha) {
        try {
          const runs = await gh<{
            check_runs: {
              name: string;
              status: string;
              conclusion: string | null;
              html_url: string;
            }[];
          }>(conn.token, `${base}/commits/${headSha}/check-runs?per_page=30`);
          checks = runs.check_runs.map((run) => ({
            name: run.name,
            status: run.status,
            conclusion: run.conclusion ?? "pending",
            url: run.html_url,
          }));
          if (checks.length === 0) checksNote = "GitHub reported no CI checks for this commit.";
        } catch (error) {
          checksNote =
            error instanceof Error ? error.message : "CI status could not be read for this commit.";
        }
      }

      return {
        ok: true as const,
        repo: `${conn.repoOwner}/${conn.repoName}`,
        defaultBranch: conn.defaultBranch,
        branches: branches.map((b) => ({ name: b.name, sha: b.commit.sha })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.commit.message.split("\n")[0] ?? "",
          author: c.commit.author?.name ?? "unknown",
          date: c.commit.author?.date ?? "",
          url: c.html_url,
        })),
        pulls: pulls.map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          url: p.html_url,
          head: p.head.ref,
          base: p.base.ref,
          draft: p.draft,
        })),
        issues: issues
          .filter((i) => !i.pull_request)
          .map((i) => ({ number: i.number, title: i.title, url: i.html_url })),
        checks,
        checksNote,
      };
    } catch (error) {
      return fail(error);
    }
  });

/** Real diff between two refs, including per-file patches GitHub returns. */
export const compareRefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompareInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      const result = await gh<{
        ahead_by: number;
        behind_by: number;
        total_commits: number;
        files?: {
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          patch?: string;
        }[];
      }>(
        conn.token,
        `/repos/${conn.repoOwner}/${conn.repoName}/compare/${encodeURIComponent(data.base)}...${encodeURIComponent(data.head)}`,
      );
      return {
        ok: true as const,
        aheadBy: result.ahead_by,
        behindBy: result.behind_by,
        totalCommits: result.total_commits,
        files: (result.files ?? []).map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? "",
        })),
      };
    } catch (error) {
      return fail(error);
    }
  });

/**
 * Writes files to a branch as one commit. Requires an approved
 * action_approvals row; without it nothing is sent to GitHub.
 */
export const commitFilesToGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CommitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection, consumeApproval } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      const target = `${conn.repoOwner}/${conn.repoName}@${data.branch}`;
      await consumeApproval({
        approvalId: data.approvalId,
        userId: context.userId,
        action: "github_push",
        target,
      });

      const base = `/repos/${conn.repoOwner}/${conn.repoName}`;
      const ref = await gh<{ object: { sha: string } }>(
        conn.token,
        `${base}/git/ref/heads/${encodeURIComponent(data.branch)}`,
      );
      const parentSha = ref.object.sha;
      const parentCommit = await gh<{ tree: { sha: string } }>(
        conn.token,
        `${base}/git/commits/${parentSha}`,
      );

      const blobs = await Promise.all(
        data.files.map(async (file) => {
          const blob = await gh<{ sha: string }>(conn.token, `${base}/git/blobs`, {
            method: "POST",
            body: { content: file.content, encoding: "utf-8" },
          });
          return { path: file.path.replace(/^\/+/, ""), mode: "100644", type: "blob", sha: blob.sha };
        }),
      );

      const tree = await gh<{ sha: string }>(conn.token, `${base}/git/trees`, {
        method: "POST",
        body: { base_tree: parentCommit.tree.sha, tree: blobs },
      });
      const commit = await gh<{ sha: string; html_url: string }>(conn.token, `${base}/git/commits`, {
        method: "POST",
        body: { message: data.message, tree: tree.sha, parents: [parentSha] },
      });
      await gh(conn.token, `${base}/git/refs/heads/${encodeURIComponent(data.branch)}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });

      return {
        ok: true as const,
        sha: commit.sha,
        url: commit.html_url,
        previousSha: parentSha,
        files: data.files.length,
      };
    } catch (error) {
      return fail(error);
    }
  });

/** Opens a pull request. Also gated behind an approved action. */
export const openPullRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PullRequestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { gh, loadConnection, consumeApproval } = await import("./github.server");
    try {
      const conn = await loadConnection(data.connectionId, context.userId);
      await consumeApproval({
        approvalId: data.approvalId,
        userId: context.userId,
        action: "github_pull_request",
        target: `${conn.repoOwner}/${conn.repoName}:${data.head}->${data.base}`,
      });
      const pr = await gh<{ number: number; html_url: string }>(
        conn.token,
        `/repos/${conn.repoOwner}/${conn.repoName}/pulls`,
        {
          method: "POST",
          body: { title: data.title, body: data.body, head: data.head, base: data.base },
        },
      );
      return { ok: true as const, number: pr.number, url: pr.html_url };
    } catch (error) {
      return fail(error);
    }
  });
