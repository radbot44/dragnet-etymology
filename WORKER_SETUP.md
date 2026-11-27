# DRAgNEt Unified Single-Repo Worker Setup (`$0/month` Tier)

This kit upgrades `radbot44/dragnet-etymology` into a single-repo, single-Worker hub serving:
- **Static Astro site** (`dist/`) at zero Worker request cost via selective `run_worker_first`
- **Stateless Remote MCP Server** at `POST /mcp` (Claude Desktop, Claude Code, Cursor, MCP clients)
- **REST + OpenAPI 3.1 Hub** at `/api/v1/*` and `/api/v1/openapi.json` (ChatGPT Custom GPT Actions, Gemini scheduled tasks, CLI scripts)
- **Edge-cached R2 Proof Scans** at `/scans/*` (falling back to `public/scans/` until deleted from Git)
- **Automated GitHub Pull Requests** (`POST /api/v1/runs/open-pr` / MCP `open_case_pull_request`)

## 1. Unpack Into Your Repository Root

```bash
unzip -o dragnet_single_repo_worker_kit.zip -d /path/to/dragnet-etymology
cd /path/to/dragnet-etymology
```

## 2. Create the Free D1 Database, R2 Bucket, and Two Secrets

```bash
# 1) Create the D1 SQLite database and paste the returned database_id into wrangler.jsonc
npx wrangler d1 create dragnet-db

# 2) Create the R2 bucket for WebP proof plates
npx wrangler r2 bucket create dragnet-scans

# 3) Set your shared AI Bearer token (any strong random string, e.g. `openssl rand -hex 32`)
npx wrangler secret put DRAGNET_API_KEY

# 4) Set a fine-grained GitHub Personal Access Token scoped ONLY to radbot44/dragnet-etymology
#    Permissions -> Repository permissions: Contents (Read and write), Pull requests (Read and write)
npx wrangler secret put GITHUB_PAT
```

## 3. Seed D1 + Upload Existing 827 WebPs to R2

The kit includes a pre-generated `worker/migrations/0002_seed_existing_corpus.sql` and `public/data/r2-scan-manifest.json` covering all 160 targets (reconciled with Wave 9 `jamboree`/`skedaddle`/`malarkey`/`jinx` and the `shindy` embargo, starting at block `2900`) and all 954 published citations.

```bash
# Dry-run verify locally in Python sqlite3 first:
python3 scripts/migrate_to_d1_r2.py --verify-sqlite

# Push schema + 160-target queue + 954 citations to D1 and upload all WebPs to R2:
python3 scripts/migrate_to_d1_r2.py --execute --d1-name dragnet-db --r2-bucket dragnet-scans
```

Once deployed and verified live:

```bash
npm run deploy
# Optional: remove binary images from Git now that R2 + public/data/r2-scan-manifest.json serve & validate them!
git rm -r public/scans
npm run validate
git commit -am "Upgrade DRAgNEt to unified Worker + D1 + R2 MCP/REST hub"
git push
```

## 4. Connect Any AI Model

| Client | Endpoint / Config | Auth |
| :--- | :--- | :--- |
| **ChatGPT (Plus / Personal)** | Create a Custom GPT → **Actions** → **Import from URL**: `https://dragnet.tch.one/api/v1/openapi.json` | Authentication: **API Key** → **Bearer** → `<DRAGNET_API_KEY>` |
| **Claude / Cursor / Windsurf** | Remote Streamable HTTP MCP URL: `https://dragnet.tch.one/mcp` | Header `Authorization: Bearer <DRAGNET_API_KEY>` |
| **Gemini Scheduled Tasks** | Call `https://dragnet.tch.one/api/v1/runs/claim`, `/scans/upload`, `/citations/upsert`, `/runs/advance`, and `/runs/open-pr` | Header `Authorization: Bearer <DRAGNET_API_KEY>` |
