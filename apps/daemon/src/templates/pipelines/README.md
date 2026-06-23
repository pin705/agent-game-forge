# OGF pipelines — the studio's build architecture

This folder is the **orchestration layer**, adopted from OpenMontage's
proven structure (declarative pipelines + director skills + checkpoint state
machine + tool registry), adapted to OGF's chassis (vanilla-Canvas games,
the user's own CLI as orchestrator, stdlib tools).

## The layers

| Layer | File(s) | Role |
|---|---|---|
| **Pipeline manifest** | `game-build.yaml` | Declarative stage list: what to build, in what order, what each stage produces, where it gates for approval. |
| **Stage director skills** | `stages/*-director.md` | One per stage. Teaches you HOW to execute that stage; references the deeper conventions (it does not duplicate them). |
| **Checkpoint state machine** | `checkpoint-protocol.md` + `../../.agents/tools/pipeline.py` | Tracks progress in `.ogf/pipeline/state.json`; resumable; enforces approval gates. |
| **Tool registry** | `tools.yaml` | The agent's tool menu — capability, cost, when-to-use for every `.agents/tools/*`. |

## How a build runs

```
read game-build.yaml ──▶ pipeline.py next ──▶ read stages/<stage>-director.md
        ▲                                              │
        │                                              ▼
   pipeline.py done <stage> ◀── (approval gate?) ◀── do the work + tool calls
```

1. At Phase 0 you read `game-build.yaml` (the outline) and `tools.yaml` (your toolbox).
2. `pipeline.py next` tells you the current stage + its director skill.
3. You read the director skill, do the work (calling tools per `tools.yaml`),
   and produce the stage's artifact.
4. On creative gates you get the user's approval; then `pipeline.py done`.
5. Repeat until `publish`.

## Why this beats a freeform phase plan

- **Repeatable**: every game follows the same proven spine.
- **Resumable**: a crash resumes from the last checkpoint, not from scratch.
- **Steerable**: the user approves at the creative gates (genre, spec, look,
  publish) and nowhere else.
- **Inspectable**: `state.json` is a clean progress signal the UI can render.
- **Cost-honest**: free-asset-first is baked into the `assets` stage; the
  default build budget is `$0`.

The detailed per-system phase plan still lives in `spec.md §7` and is governed by
`conventions/common.md` + the genre file — that's the INNER plan for the
`systems` stage. This pipeline is the OUTER spine around it.
