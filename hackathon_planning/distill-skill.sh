#!/usr/bin/env bash
# distill-skill.sh — Task 1 MVP: distill stored brain data into a landed, routable
# Nurse/Psychiatrist decision-support SKILL.md, matching the seed-skill shape.
#
# Flow: local-Qwen subagent (grounded via the query tool) authors the SKILL.md BODY →
# we assemble deterministic frontmatter (name/role/triggers/tools) + the body →
# write skills/<slug>/SKILL.md → append a RESOLVER.md row under "## Patient care" →
# validate with check-resolvable.
#
# RUN INSIDE THE CONTAINER, e.g.:
#   SLUG=nurse-behavioral-fall-risk ROLE=nurse \
#   TRIGGERS='agitation,wandering,fall risk,behavioral change,post-fall review' \
#   DESC='Nurse decision-support for behavioral change and fall-risk monitoring in dementia residents.' \
#   TOPIC='resident behavioral transmission notes (agitation, wandering, urinating in hallways, fall events) and the Geriatric Care Assistant (ASG) role protocol' \
#   bash /app/hackathon_planning/distill-skill.sh
set -uo pipefail

export OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-http://localhost:1234/v1}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-lmstudio}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:1234/v1}"
CHAT_MODEL="${CHAT_MODEL:-openrouter:qwen/qwen3.6-27b}"

SLUG="${SLUG:?set SLUG (lowercase-kebab)}"
ROLE="${ROLE:?set ROLE (nurse|psychiatrist|general-medicine)}"
TRIGGERS="${TRIGGERS:?set TRIGGERS (comma-separated phrases)}"
DESC="${DESC:?set DESC (one-line description)}"
TOPIC="${TOPIC:?set TOPIC (what to query the brain for)}"

case "$ROLE" in nurse|psychiatrist|general-medicine) ;; *) echo "bad ROLE: $ROLE"; exit 1;; esac

GB=(bun /app/src/cli.ts)
SKILLS=/app/skills
RESOLVER="$SKILLS/RESOLVER.md"
BRAIN=/root/.gbrain/brain.pglite
cd /app

# stale-lock guard (rm only — never pkill from inside a script whose text matches the pattern)
rm -rf "$BRAIN/.gbrain-lock" "$BRAIN/postmaster.pid" 2>/dev/null || true

echo "════ 1. Author SKILL body via subagent (grounded in brain) ════"
PROMPT="You are distilling stored nursing-home brain data into the BODY of a reusable ${ROLE} decision-support skill named '${SLUG}'. First call the query tool 2-3 times to gather what the brain knows about: ${TOPIC}. Then write a SKILL.md body in GitHub-flavored markdown that MATCHES this structure exactly: (1) an H1 line '# ${SLUG} — <short human title>'; (2) a 2-3 sentence intro; (3) '## Phase 1: Brain-First Lookup' telling the user to run gbrain query for the patient's context first; (4) '## Contract' with Input, Output, and 'Side effect: none by default (mutating: false)'; (5) '## When to invoke' as a bullet list; (6) '## Procedure' as a numbered list of 4-6 steps GROUNDED in the actual resident behaviors, scales, or protocol duties you found in the brain (reference them concretely); (7) '## Guardrails' that includes a 'Decision support, not diagnosis' bullet and an 'APPI / 要配慮個人情報' source-isolation bullet. Output ONLY the markdown body starting at the '# ' line. Do NOT include YAML frontmatter. Do NOT wrap the output in code fences."
PARAMS=$(python3 -c "import json,sys;print(json.dumps({'prompt':sys.argv[1],'model':sys.argv[2],'max_turns':12}))" "$PROMPT" "$CHAT_MODEL")

LOG=$(mktemp)
timeout 600 "${GB[@]}" jobs submit subagent --params "$PARAMS" --follow > "$LOG" 2>&1
tail -4 "$LOG"

BODY=$(python3 - "$LOG" <<'PY'
import json,sys,re
txt=open(sys.argv[1]).read()
m=re.search(r'^Result:\s*(\{.*\})\s*$', txt, re.M|re.S)
if not m: sys.stderr.write("no Result JSON line in job output\n"); sys.exit(2)
body=json.loads(m.group(1)).get("result","").strip()
body=re.sub(r'^```(?:markdown)?\s*\n?','',body); body=re.sub(r'\n?```$','',body)   # strip code fences
i=body.find('# ')                                                                   # trim any preamble
if i>0: body=body[i:]
print(body.strip())
PY
) || { echo "✗ could not extract body from job result"; exit 1; }

if [ -z "$BODY" ] || ! grep -q '^# ' <<<"$BODY"; then echo "✗ authored body empty/malformed"; exit 1; fi
echo "  ✓ authored $(wc -l <<<"$BODY") lines"

echo "════ 2. Assemble skills/$SLUG/SKILL.md (deterministic frontmatter + body) ════"
mkdir -p "$SKILLS/$SLUG"
{
  echo '---'
  echo "name: $SLUG"
  echo 'version: 0.1.0'
  echo 'description: |'
  echo "  $DESC"
  echo 'triggers:'
  IFS=',' read -ra T <<<"$TRIGGERS"; for t in "${T[@]}"; do t="$(echo "$t"|sed 's/^ *//;s/ *$//')"; echo "  - \"$t\""; done
  echo "role: $ROLE"
  echo 'tools:'; for x in search query get_page list_pages; do echo "  - $x"; done
  echo 'mutating: false'
  echo '---'
  echo
  printf '%s\n' "$BODY"
} > "$SKILLS/$SLUG/SKILL.md"
echo "  ✓ wrote $SKILLS/$SLUG/SKILL.md ($(wc -l <"$SKILLS/$SLUG/SKILL.md") lines)"

echo "════ 3. Add RESOLVER.md row under '## Patient care' ════"
SLUG="$SLUG" ROLE="$ROLE" TRIGGERS="$TRIGGERS" RESOLVER="$RESOLVER" python3 - <<'PY'
import os,re
p=os.environ["RESOLVER"]; slug=os.environ["SLUG"]; role=os.environ["ROLE"]
trigs=[t.strip() for t in os.environ["TRIGGERS"].split(",") if t.strip()]
lines=open(p).read().splitlines()
if any(f"skills/{slug}/SKILL.md" in l for l in lines):
    print(f"  • row for {slug} already present — skipping"); raise SystemExit
trig_str=", ".join(f'"{t}"' for t in trigs)
row=f"| {trig_str} | `skills/{slug}/SKILL.md` (role: {role}) |"
# find the Patient care table; insert after its last table row
try: start=next(i for i,l in enumerate(lines) if l.startswith("## Patient care"))
except StopIteration: print("  ✗ '## Patient care' section not found"); raise SystemExit(1)
end=next((i for i in range(start+1,len(lines)) if lines[i].startswith("## ")), len(lines))
last=max(i for i in range(start,end) if lines[i].strip().startswith("|"))
lines.insert(last+1,row)
open(p,"w").write("\n".join(lines)+"\n")
print(f"  ✓ inserted resolver row after line {last+1}")
PY

echo "════ 3b. Register in skills/manifest.json (else it orphans in check-resolvable) ════"
SLUG="$SLUG" DESC="$DESC" MANIFEST="$SKILLS/manifest.json" python3 - <<'PY'
import os,json
p=os.environ["MANIFEST"]; slug=os.environ["SLUG"]
m=json.load(open(p))
if any(s.get("name")==slug for s in m["skills"]):
    print(f"  • {slug} already in manifest — skipping"); raise SystemExit
entry={"name":slug,"path":f"{slug}/SKILL.md","description":os.environ["DESC"]}
idx=next((i for i,s in enumerate(m["skills"]) if s.get("name")=="nurse-triage"), len(m["skills"])-1)
m["skills"].insert(idx+1, entry)
json.dump(m, open(p,"w"), indent=2, ensure_ascii=False); open(p,"a").write("\n")
print(f"  ✓ registered {slug} in manifest ({len(m['skills'])} skills)")
PY

echo "════ 4. Validate ════"
"${GB[@]}" check-resolvable 2>&1 | tail -8 || true
echo
echo "Done. Review: skills/$SLUG/SKILL.md   (git diff skills/RESOLVER.md for the routing row)"
