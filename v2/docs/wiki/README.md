# Track Expense v2 wiki

The memory of the project: what was decided, how it fits together, and how
to run it. Written for the owner and for AI coding agents alike. Keep it
true: when you change behaviour, update the page in the same change.

| Page | Read it when |
|---|---|
| [decisions.md](decisions.md) | Before changing anything structural. Numbered log, newest first |
| [architecture.md](architecture.md) | You need the map: pieces, run modes, folders, data flows |
| [ai-agent.md](ai-agent.md) | Touching the assistant, its tools, models or eval |
| [sms.md](sms.md) | Touching bank SMS detection or planning auto-add |
| [design-system.md](design-system.md) | Building or changing UI |
| [testing.md](testing.md) | Adding tests or checking a change |
| [operations.md](operations.md) | Running, deploying, migrating, or something is broken |
| [roadmap.md](roadmap.md) | Deciding what to do next; what is blocked on the owner |

Elsewhere:
- Data contract: [`../../backend/SCHEMA.md`](../../backend/SCHEMA.md)
- Agent instructions: [`../../CLAUDE.md`](../../CLAUDE.md)
- v1 feature reference (for parity questions): [`../../../FEATURES.md`](../../../FEATURES.md)

## Adding a decision

Append to the top of `decisions.md`:

```
## D-0NN · Short title
**YYYY-MM-DD · Accepted · who decided**

What was decided, why, and what it rules out.
```
If it replaces an earlier one, mark the old entry **Superseded by D-0NN**.
