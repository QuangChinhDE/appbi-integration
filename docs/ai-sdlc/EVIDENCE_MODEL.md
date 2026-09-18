# The evidence model

How this repository makes "I checked" into something other than a sentence.
Read this once; the mechanisms it describes are what `CLAUDE.md`,
`REVIEW.md` and `DEFINITION_OF_DONE.md` all assume when they say "current
evidence" or "stale".

## The pipeline

```
SESSION START           scripts/session_context.py (SessionStart hook)
   ↓                    prints branch, fingerprint, active change, evidence
   ↓                    status — rediscovered from the repository, not memory
REPOSITORY STATE CHECK  git status, scripts/repo_fingerprint.py
   ↓
CHANGE PREFLIGHT        /preflight — reads intent/spec/plan, names layers and
   ↓                    invariants, classifies risk, records the starting
   ↓                    fingerprint, writes .claude/active-change
IMPLEMENTATION GATE     scripts/claude_guard.py (PreToolUse) — asks before
   ↓                    product code is touched with no active change or
   ↓                    declared light-path fix
CODE
   ↓
CURRENT-DIFF FINGERPRINT   scripts/repo_fingerprint.py
   ↓
TARGETED VERIFICATION   scripts/verify.py targeted <area> → records
   ↓                    verification/<area> evidence at that fingerprint
INDEPENDENT REVIEW      the four reviewer agents → scripts/record_review.py
   ↓                    records review/<reviewer> evidence at that fingerprint
ACCEPTANCE              acceptance.md walked in the running product
   ↓
FULL VERIFICATION       scripts/verify.py full → records verification/full
   ↓                    (and each area separately) at that fingerprint
FINAL-DIFF FINGERPRINT  scripts/repo_fingerprint.py (should be unchanged
   ↓                    since full verification, or it needs to run again)
COMPLETION GATE         scripts/completion_gate.py (Stop hook) — refuses an
   ↓                    apparent "Done" claim if required evidence for the
   ↓                    current fingerprint is missing, stale, or failing
DONE
```

## The one rule everything else follows from

> **Evidence is valid only for the exact repository state that produced it.**

`scripts/repo_fingerprint.py` is that state's name: a SHA-256 over HEAD plus
the content of every tracked-or-untracked, non-ignored file (see its
docstring for the two narrow, documented exclusions). Identical source state
→ identical fingerprint, on any machine. One byte different anywhere → a
different fingerprint.

`scripts/evidence.py` is the record: every verification run and every
reviewer verdict is written as JSON tagged with the fingerprint it attests to,
under `.claude/evidence/` (gitignored — this is session-local, not history).
`python scripts/evidence.py status` shows, right now, which records are
**CURRENT** (fingerprint matches the tree) and which are **STALE** (it does
not). Nothing here depends on a timestamp or on remembering when something
ran; it depends on whether the bytes still match.

## What this makes impossible, or at least visible

- **Verify, edit, claim Done without re-verifying.** The edit changes the
  fingerprint; the old evidence reads STALE; `completion_gate.py` sees that
  and blocks a detected completion claim, naming exactly what to re-run.
- **Review, fix, claim the fix is proven by the review that found it.** The
  fix changes the fingerprint; `review/<reviewer>` for the old fingerprint is
  STALE; REVIEW.md's review-fix-review loop says the reviewer runs again.
- **"I ran the QA reviewer" as an unverifiable claim.** The reviewer's last
  action is `scripts/record_review.py`; if it did not run, there is no
  `review/qa-reviewer` record at all, which is as visible as a stale one.
- **A resumed or fresh session assuming "already checked".**
  `session_context.py` reports the current fingerprint and evidence status at
  the start of every session, read from the repository, not carried in
  conversation memory that a compaction or a new session would not have.

## What it deliberately does not do

- It does not run anything automatically after every edit. `PostToolUse`
  running the full suite on every keystroke was explicitly rejected — fast
  feedback while editing, strong proof before completion, not the same
  intensity for both. Recording evidence happens when `verify.py` or a
  reviewer is deliberately run.
- It does not read the assistant's intentions. `completion_gate.py`'s
  transcript heuristic looks for *phrases* ("implementation complete",
  "ready to merge", ...), not semantic understanding, and explicitly lets an
  honest "STATUS: NOT DONE" through. It is a backstop against the common
  failure, not a guarantee against every wording that implies completion
  without using a recognised phrase — see its module docstring.
- It does not replace `.github/workflows/ci.yml`. CI's own pass/fail is
  itself evidence, for the commit it ran against; `scripts/verify.py`
  deliberately mirrors CI's exact commands (see its docstring) so the two
  never define "passing" differently. `scripts/guardrails.py` is the shared
  file both call, for the same reason.

## Commands

```bash
python scripts/repo_fingerprint.py [--explain] [--check FP]
python scripts/evidence.py status
python scripts/evidence.py check --kind verification|review --area <name>
python scripts/verify.py quick|targeted <area>|full   # records automatically
python scripts/record_review.py --reviewer <name> --status ... --blocker N ...
```
