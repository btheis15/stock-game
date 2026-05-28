// GitHub Contents API helper — used by the funds CRUD routes (and any
// future "save to repo" feature) to commit JSON changes straight to
// origin/main without a server-side checkout.
//
// Why the Contents API rather than a clone + push: Vercel functions have
// ephemeral filesystems, can't keep a checked-out repo around, and don't
// have SSH credentials anyway. The Contents API is the standard "edit one
// file" path — auth via a PAT in env, atomic single-commit writes,
// returns the new SHA so we can chain reads + writes safely.
//
// Required env vars (set on the Vercel project):
//   - GITHUB_TOKEN: fine-grained PAT with Contents: read+write on the repo
//   - GITHUB_OWNER: repo owner login (e.g. "btheis15")
//   - GITHUB_REPO:  repo name (e.g. "stock-game")
//
// Concurrency model: two simultaneous saves of config/funds.json race on
// the SHA. The PUT then fails with 409, we re-fetch, re-apply the updater,
// retry — bounded at 3 attempts so a long-stuck race surfaces as an error
// rather than spinning forever.

const GITHUB_API = "https://api.github.com";

export interface GithubFileGetResult {
  /** Decoded UTF-8 file content. */
  content: string;
  /** Blob SHA — must be passed back on PUT to update the file. */
  sha: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}. The GitHub commit API requires GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO to be set on Vercel.`
    );
  }
  return v;
}

function authHeaders(): HeadersInit {
  const token = requireEnv("GITHUB_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoPath(): { owner: string; repo: string } {
  return {
    owner: requireEnv("GITHUB_OWNER"),
    repo: requireEnv("GITHUB_REPO"),
  };
}

/** Read the current contents of a file on origin/main. Returns null when
 *  the file doesn't exist (the caller's updater starts from empty). */
export async function getGithubFile(path: string): Promise<GithubFileGetResult | null> {
  const { owner, repo } = repoPath();
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=main`;
  const res = await fetch(url, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { content: string; encoding: string; sha: string };
  if (body.encoding !== "base64") {
    throw new Error(`Unexpected GitHub encoding for ${path}: ${body.encoding}`);
  }
  // GitHub returns base64-encoded content with line breaks in the string.
  const decoded = Buffer.from(body.content, "base64").toString("utf8");
  return { content: decoded, sha: body.sha };
}

/** Apply an updater function to a JSON file on origin/main, committing the
 *  result as a single commit on main. Retries the GET+PUT cycle up to 3
 *  times if the SHA changes between read and write (two simultaneous saves
 *  hitting the same file). The commit message becomes the git-log entry —
 *  keep it short and human-readable since it shows in the repo's history. */
export async function updateGithubJsonFile<T>(
  path: string,
  commitMessage: string,
  updater: (current: T) => T,
  emptyValue: T,
): Promise<{ newSha: string; newContent: T }> {
  const { owner, repo } = repoPath();
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await getGithubFile(path);
    let parsed: T;
    if (current === null) {
      parsed = emptyValue;
    } else {
      try {
        parsed = JSON.parse(current.content) as T;
      } catch (e) {
        throw new Error(
          `GitHub file ${path} is not valid JSON; refusing to overwrite. Original error: ${(e as Error).message}`
        );
      }
    }
    const next = updater(parsed);
    // Pretty-print with a trailing newline so the file reads cleanly in
    // GitHub's web UI and diffs line-by-line.
    const newContent = JSON.stringify(next, null, 2) + "\n";
    const body = {
      message: commitMessage,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      sha: current?.sha,
      branch: "main",
    };
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) {
      const updated = (await res.json()) as { content: { sha: string } };
      return { newSha: updated.content.sha, newContent: next };
    }
    if (res.status === 409 || res.status === 422) {
      // SHA mismatch (concurrent edit) — refetch + retry. 422 is what
      // GitHub returns when the supplied sha doesn't match; treat the
      // same as 409 (conflict).
      lastErr = `concurrent edit (${res.status}); retrying (${attempt}/3)`;
      continue;
    }
    throw new Error(`GitHub PUT ${path} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`GitHub PUT ${path} gave up after 3 retries: ${lastErr ?? "unknown"}`);
}
