#!/usr/bin/env bash
# Deploys apps/web to Vercel production as a prebuilt output (docs/DECISIONS.md, "Hosting").
# The Vercel project's Root Directory is "." and CLI 48 can't change it, so the build runs here,
# from the repo root, with apps/web as its root. Needs `vercel login` and, once,
# `vercel link --project bearer` at the repo root. Production env vars live on the project.
set -euo pipefail
cd "$(dirname "$0")/.."

vercel pull --yes --environment=production
node -e '
  const fs = require("fs");
  const p = ".vercel/project.json";
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.settings.rootDirectory = "apps/web";
  d.settings.nodeVersion = "22.x"; // CLI 48 rejects the project default, 26.x
  fs.writeFileSync(p, JSON.stringify(d));
'

# apps/web/.env.local may name the repository, which is private for now; drop this once it's public.
NEXT_PUBLIC_REPO_URL= vercel build --prod

if grep -rqE "localhost:3000" .vercel/output; then
  echo "The build still points at localhost:3000: set NEXT_PUBLIC_SITE_URL on the Vercel project." >&2
  exit 1
fi
vercel deploy --prebuilt --prod
