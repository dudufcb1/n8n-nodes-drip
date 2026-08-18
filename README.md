# n8n-nodes-drip

A one-purpose gate node for n8n: it holds whatever comes in for a random amount of time, then lets it through.

Useful anywhere you are pacing calls to an API, a mailbox or a messaging provider and you do not want a perfectly regular rhythm. Instead of a Code node that rolls a random number plus a Wait node that consumes it, you get one node with a minimum and a maximum.

## Install

Settings → Community nodes → Install → `n8n-nodes-drip`

## Parameters

| Parameter | What it does |
| --- | --- |
| Pace | `Fast` (3-5 s), `Medium` (10-20 s), `Slow` (1-3 min) or `Custom` |
| Minimum / Maximum / Unit | Only with `Custom`. Milliseconds, seconds or minutes. |
| Apply | `Once per Run` (default) or `Per Item` |
| Wait Mode | `Auto` (default), `In Memory` or `Persistent` |
| Options → Output Delay | Adds a `dripDelayMs` field to every output item |

## Inside a loop

A node inside a Loop Over Items runs once per iteration, so `Once per Run` already waits on every pass. That is the usual setup: Loop Over Items → Drip → the call you are pacing → back to the loop.

## Wait modes

`In Memory` sleeps and keeps the execution running. Simple and exact, but it holds an execution slot.

`Persistent` parks the execution in the database and frees the worker. The scheduler wakes waiting executions up every 60 seconds, so anything shorter than a minute gets rounded up to roughly a minute — measured at 2m42s for three loop iterations of 2 seconds each.

`Auto` picks in-memory below 65 seconds and persistent above it, which is the threshold n8n's own Wait node uses.

`Per Item` always waits in memory: the engine keeps a single `waitTill` per execution, so persisting inside a per-item loop would only honour the last one.

## License

MIT
