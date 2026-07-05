# hackathon_raw_data/

Local raw data + **the brain database** live here. The folder is tracked; its contents are
**gitignored** (see `.gitignore` — only `.gitignore` and this `README.md` are committed).

## What goes in here

- **The database** — the local brain DB (e.g. the PGLite data directory, or a Postgres dump /
  connection artifact used locally). Point `gbrain` at this folder for its store.
- Raw source data to be distilled into skills (nurse / psychiatrist notes, records).
- Sample patient inputs + history used by the orchestrator and eval fixtures.

## Why it's gitignored

Patient-derived and brain data is sensitive (Japan APPI 要配慮個人情報) and often large. It must
never be committed. Only the folder skeleton (`.gitignore` + this README) is tracked so the path
exists on a fresh clone.

## Setup

Each dev creates/populates their own `hackathon_raw_data/` locally. Nothing here syncs via git — share the
dataset out-of-band (secure transfer), not through the repo.
