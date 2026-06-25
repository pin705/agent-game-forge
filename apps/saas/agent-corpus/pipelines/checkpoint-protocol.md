# Checkpoint protocol — how to run the pipeline

> Adopted from OpenMontage's checkpoint state machine. The pipeline is a
> resumable sequence of stages. You (the agent) advance it one stage at a time,
> recording a checkpoint after each so a failed/interrupted run resumes from the
> last good stage instead of starting over.

## The loop

At Phase 0, and after every stage, run:

```
python .agents/tools/pipeline.py next
```

It reads `.ogf/pipelines/game-build.yaml` + the checkpoint state
(`.ogf/pipeline/state.json`) and prints: the next stage, its director skill to
read, and whether it needs human approval.

Then for that stage:

1. **Read the stage director skill** it names (e.g. `.ogf/pipelines/stages/spec-director.md`).
   Mark the stage started: `python .agents/tools/pipeline.py start <stage>`.
2. **Do the work** the director describes, producing the stage's artifact.
3. **Approval gates.** This is a HOSTED, UNATTENDED run — there is NO human to
   approve mid-build. Do NOT present a gate and wait. Pick sensible defaults for
   every creative decision (title, theme, palette, mechanics), pass `--approved`
   immediately, and proceed through every stage to a finished, playable game.
   The user steers by chatting AFTER the build, not by approving mid-run. Emit a
   question-form ONLY if a request is so ambiguous that no reasonable default
   exists (rare). (`human_approval_default` is `false` for all stages here.)
4. **Checkpoint**:
   ```
   python .agents/tools/pipeline.py done <stage> --artifact <path> [--approved]
   ```
   Pass `--approved` only after the user actually approved (for approval stages).
5. Loop: `pipeline.py next` again.

## Checkpoint policies

`game-build.yaml` sets `default_checkpoint_policy: guided`:

- **guided** (default): checkpoint every stage; pause for human approval only on
  stages with `human_approval_default: true`. Best for the no-coder flow.
- **manual_all**: pause for approval on EVERY stage. Use when the user says "let
  me approve each step".
- **auto_noncreative**: only pause on creative stages; never on mechanical ones.

The user can override per-run ("just build it, don't stop to ask" → treat as
auto_noncreative; "check with me each step" → manual_all).

## Resuming

If a run dies mid-build, the next session starts with `pipeline.py status` →
shows completed/in-progress/pending stages → `pipeline.py next` resumes from the
first unfinished stage. Artifacts already on disk (spec.md, assets, src) are not
regenerated.

## Why this matters

- **Resumable**: long builds survive interruption (the daemon's 5-min stall
  watchdog, a crash, a new session).
- **Inspectable**: `state.json` is the single source of truth for "where is this
  build", which the OGF web UI can surface as a progress tracker.
- **Steerable**: approval gates put the user in control at exactly the creative
  decisions, and nowhere else.
