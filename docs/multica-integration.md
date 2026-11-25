# Multica offices

A person working across many sessions should be able to leave Habblaud in the background and return to the right task when a decision reaches them. A successful sync proves connectivity. The attention test below measures the product outcome.

## What a player sees

| Source | Office and room | Character | What opens on click |
| --- | --- | --- | --- |
| Local Codex and Claude Code | Existing local office and directory-based rooms. Worktrees keep their current room identities. | Existing local session | Local session or its pending permission request |
| Multica | An office for each selected workspace, with a room per project ID and a common area for unassigned work | One character per non-archived agent ID within the workspace, including when idle | Agent's current issues and runs, with links back to Multica |

The source selector starts with the existing local office and lets the user also select any workspaces returned by their CLI login. Persist selections on the device and validate them against the current login on reconnect. Picking a workspace never changes the CLI's active workspace. A character with two active runs has two entries in its drawer. Keep it in its current project room while work there remains active. If it needs a new room, choose a project from its active work with a stable project-ID tie break. Idle employees go to the common area.

## How updates reach the office

1. A local client lists workspaces and subscribes to the ones it selects. Each subscribed workspace shares one upstream connection across tabs. Closing its last subscriber stops that connection.
2. The server opens the workspace WebSocket, authenticates using the local Multica CLI credentials and reads facts after the acknowledgement. A change event schedules a new authenticated HTTP snapshot. Task output and heartbeats do not schedule reads. Events arriving during a read trigger a follow-up read.
3. The browser receives full replacement frames through local SSE. On disconnect, replace live facts with a stale indicator. On loss of access, clear facts. Reconnect with backoff, resnapshot after authentication and reconcile every five minutes while connected.
4. Use project and issue IDs for associations. The run snapshot covers active work and recent outcomes per agent. It is insufficient for reconstructing every historical transition. HTTP resources are read separately and can change between reads.

The adapter ships in the fork and uses Node's built-in networking. It requires a working Multica CLI login on the machine running Habblaud. Credentials are read server-side. Issue titles and agent names stay on the local API. The World uplink, remote listener, timeline and global local-session feed receive no Multica frames.

## Identity and approvals

The managed and manual probes launched Codex and Claude Code in the same worktree. In both pairs the manual session had its own native ID. Completed managed runs exposed a native ID at `result.session_id`. During active runs, the Codex rollout provided a session ID in a managed session directory. The Claude Code SessionStart integration records only the native session ID, provider, workspace and agent markers. The same-worktree test exercised a normal project settings hook for managed and manual launches. Local bindings are kept in server memory and refreshed by subsequent supported hook events.

For a selected workspace, correlate a local session with a managed run only with a single verified binding of source, workspace, provider and native session ID. For a running session, require a trustworthy association to the managed agent or run. A directory, timestamp, title, agent name or missing task environment variable cannot establish that binding. Keep uncertain sessions visible. Removing a source or losing its live facts restores the local representation.

Coalescing affects display only. An outstanding local approval keeps its original request ID, response route and single notification, including when accessed through a managed character. An issue assigned to a human for review opens that issue in Multica. A business handoff cannot grant permission to execute a command.

## Delivery and gates

| Slice | Deliverable | Gate |
| --- | --- | --- |
| 1. Local source transport | Workspace discovery, scoped HTTP snapshot, shared WebSocket subscription, local SSE, stale/unavailable states | Real CLI login produces a live frame. Regression tests cover changed pagination, scope mismatch, private fields, event bursts, disconnect, retry and denied access. |
| 2. Playable office | Source selector in Settings, workspace navigation, project rooms, persistent agent characters and a read-only drawer | Local + two selected workspaces coexist. Reload keeps the selection. A multi-run agent appears once and stays identifiable while idle. Removing a workspace stops its subscription. |
| 3. Merge managed/local sessions | Capture native provenance in the supported launch paths and transfer local pending actions to the visible character | Repeat all four managed/manual Codex/Claude runs in one worktree with normal installation. Check live and completed identity, reconnect, source deselection, ambiguous bindings and one real command approval. |
| 4. Attention pilot | Notify for an observed transition to the signed-in human and link to its issue. Distinguish review, failure, and local permissions in the drawer. | Run two parallel tasks, one requiring review and one continuing unaided. Record each manual window check, each necessary decision, missed signals and duplicate alerts across reconnect and reload. Compare with a similar pair run through the normal session workflow. |

Pilot pass condition: after dispatch, keep the office tab in the background. Every necessary decision should surface once and open the correct target. Routine starts, progress and finishes should require zero manual window checks. The first snapshot establishes the baseline. A reconnect must not announce existing assignments again. A handoff that happens entirely between snapshots can be missed. Measure this case before promising reliable alerts for transient transitions.

## Use the office

1. Run the fork locally. Sign in with the Multica CLI. In Settings → Office sources choose **Find Multica workspaces**, then check the workspaces and local providers to display.
2. Select **Multica** in the office toolbar to open a workspace or a pending issue. **All offices** returns to the combined canvas. Click an employee or a project room to see its issues and run statuses.
3. In Settings → Alerts enable browser notifications and allow them in the browser. Leave the tab open in the background. A transition to your ownership or review produces an alert linking to the original issue. The toolbar also lists review items present when the page first opened. Closed tabs cannot deliver browser events.
4. For live Claude provenance and local approvals use this fork's permission plugin or run `npm run hooks:install` for the relevant Claude configuration. Run `npm run codex:install` and trust the new entries in Codex when using its hooks. Restart sessions after installing. The hook and browser must target the same Habblaud port. Multica API reads use the local CLI login. For split-host self-hosted deployments, set `HABBLAUD_MULTICA_WEB_ORIGIN` to the public web origin.

All four slices are implemented. Regression fixtures cover mixed providers, ambiguous identities, source deselection, multiple pending permissions, concurrent runs, cold start and reconnect. The live pilot exercised both providers in one worktree, a human handoff in a genuinely backgrounded browser tab, a reload and a real Claude command denial. Managed permission routing is also exercised with synthetic pending requests. The pilot measures signal delivery. Measuring personal time saved calls for ordinary work over a longer period.

## Read the stream directly

Build and run this branch locally with Node 22.12 or newer, then use the port printed by Habblaud. These examples assume port 4747.

```sh
curl --fail http://127.0.0.1:4747/api/multica/workspaces
# Use an id from that response.
curl --no-buffer "http://127.0.0.1:4747/api/multica/workspaces/$WORKSPACE_ID/events"
```

A working subscription emits `connecting` then `live` with the selected workspace, projects, issues, agents and runs. The office UI subscribes to these same frames. The [server reference](../server/README.md#multica) describes access rules and failure states.
