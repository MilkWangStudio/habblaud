# Multica offices

A person working across many sessions should be able to leave Habblaud in the background and return to the right task when a decision reaches them. A successful sync proves connectivity. The attention test below measures the product outcome.

## What a player sees

| Source | Office and room | Character | What opens on click |
| --- | --- | --- | --- |
| Local Codex and Claude Code | Existing local office and directory-based rooms. Worktrees keep their current room identities. | Existing local session | Local session or its pending permission request |
| Multica | An office for each selected workspace, with a room per project ID and a common area for unassigned work | One character per non-archived agent ID within the workspace, including when idle | Agent's current issues and runs, with links back to Multica |

The source selector should start with the existing local office and let the user also select any workspaces returned by their CLI login. Persist selections on the device and validate them against the current login on reconnect. Picking a workspace never changes the CLI's active workspace. A character with two active runs has two entries in its drawer. Keep it in its current project room while work there remains active. If it needs a new room, choose a project from its active work with a stable project-ID tie break. Idle employees go to the common area.

## How updates reach the office

1. A local client lists workspaces and subscribes to the ones it selects. Each subscribed workspace shares one upstream connection across tabs. Closing its last subscriber stops that connection.
2. The server opens the workspace WebSocket, authenticates using the local Multica CLI credentials and reads facts after the acknowledgement. A change event schedules a new authenticated HTTP snapshot. Task output and heartbeats do not schedule reads. Events arriving during a read trigger a follow-up read.
3. The browser receives full replacement frames through local SSE. On disconnect, replace live facts with a stale indicator. On loss of access, clear facts. Reconnect with backoff, resnapshot after authentication and reconcile every five minutes while connected.
4. Use project and issue IDs for associations. The run snapshot covers active work and recent outcomes per agent. It is insufficient for reconstructing every historical transition. HTTP resources are read separately and can change between reads.

The adapter ships in the fork and uses Node's built-in networking. It requires a working Multica CLI login on the machine running Habblaud. Credentials are read server-side. Issue titles and agent names stay on the local API. The World uplink, remote listener, timeline and global local-session feed receive no Multica frames.

## Identity and approvals

The managed and manual probes launched Codex and Claude Code in the same worktree. In both pairs the manual session had its own native ID. Completed managed runs exposed a native ID at `result.session_id`. During active runs, the Codex rollout provided a session ID in a managed session directory. A Claude Code SessionStart probe explicitly installed for the managed launch observed a native session ID plus workspace and agent markers. Availability of the same hook under an ordinary installation is a separate release gate.

For a selected workspace, correlate a local session with a managed run only with a single verified binding of source, workspace, provider and native session ID. For a running session, require a trustworthy association to the managed agent or run. A directory, timestamp, title, agent name or missing task environment variable cannot establish that binding. Keep uncertain sessions visible. Removing a source or losing its live facts restores the local representation.

Coalescing affects display only. An outstanding local approval keeps its original request ID, response route and single notification, including when accessed through a managed character. An issue assigned to a human for review opens that issue in Multica. A business handoff cannot grant permission to execute a command.

## Delivery and gates

| Slice | Deliverable | Gate |
| --- | --- | --- |
| 1. Local source transport (implemented on this branch) | Workspace discovery, scoped HTTP snapshot, shared WebSocket subscription, local SSE, stale/unavailable states | Real CLI login produces a live frame. Regression tests cover changed pagination, scope mismatch, private fields, event bursts, disconnect, retry and denied access. |
| 2. Playable office | Source selector in Settings, workspace navigation, project rooms, persistent agent characters and a read-only drawer | Local + two selected workspaces coexist. Reload keeps the selection. A multi-run agent appears once and stays identifiable while idle. Removing a workspace stops its subscription. |
| 3. Merge managed/local sessions | Capture native provenance in the supported launch paths and transfer local pending actions to the visible character | Repeat all four managed/manual Codex/Claude runs in one worktree with normal installation. Check live and completed identity, reconnect, source deselection, ambiguous bindings and one real command approval. |
| 4. Attention pilot | Notify for an observed transition to the signed-in human and link to its issue. Distinguish review, failure, and local permissions in the drawer. | Run two parallel tasks, one requiring review and one continuing unaided. Record each manual window check, each necessary decision, missed signals and duplicate alerts across reconnect and reload. Compare with a similar pair run through the normal session workflow. |

Pilot pass condition: after dispatch, keep the office tab in the background. Every necessary decision should surface once and open the correct target. Routine starts, progress and finishes should require zero manual window checks. The first snapshot establishes the baseline. A reconnect must not announce existing assignments again. A handoff that happens entirely between snapshots can be missed. Measure this case before promising reliable alerts for transient transitions.

## Try the first slice

Build and run this branch locally with Node 22.12 or newer, then use the port printed by Habblaud. These examples assume port 4747.

```sh
curl --fail http://127.0.0.1:4747/api/multica/workspaces
# Use an id from that response.
curl --no-buffer "http://127.0.0.1:4747/api/multica/workspaces/$WORKSPACE_ID/events"
```

A working subscription emits `connecting` then `live` with the selected workspace, projects, issues, agents and runs. This slice is available through the API. The source selector and NPCs arrive in slice 2. The [server reference](../server/README.md#multica) describes access rules and failure states.
