# Expense reports (D-033)

A report is a saved, full-page picture of a period's spending for the whole
household, optionally set against another period, with a short AI-written
narrative on top. Experimental, on branch `exp/ai-reports`.

## Where to find it

- **Insights › Reports** (`/reports`): monthly reports first, then on-demand
  ones, newest first; **New report** at the top.
- **Monthly push** on the 1st at 07:00 India time: "Your October report is
  ready", one per member; it opens `/reports/monthly_2026-10`. The same entry
  is in Activity (only for the member it is addressed to).
- **Home › For you**: the month's review card opens that month's report once
  it exists.

## What is in a report

Every figure is computed in `backend/functions/src/core/report.ts`
(`buildReport`), reusing the assistant's core code, and has a `…Display`
string. Empty sections are left out.

| Section | Contents | With a comparison |
|---|---|---|
| Headline | Spent, income, net, savings rate, entries, spent per day | Delta and % for each; savings rate in points; per-day delta so different lengths compare fairly |
| Categories | Total, share, entries (expenses) | Delta per category; new and vanished flagged |
| Members | Spent and share per member (₹0 rows included) | Delta per member |
| Rhythm | Spend by week, weekend share, biggest day | Weekend share then |
| Merchants | Top 5 by spend and by visits | Rank changes, new |
| Notable | 5 largest, anomalies, likely duplicates | — |
| Bills | Recurring bills paid, not recorded, price changes | — |
| Budgets | Calendar month or month to date: spent vs budget | Calendar months: the comparison month's use of the same budget |
| Tags | Total per tag, if any entries are tagged | Delta |

A refund is an income entry (the app has no refund type), so it counts as
income and does not lower a category's spending.

## Periods and comparisons

On-demand presets: last month, this month so far, last 7 days, last 30 days,
a picked month, a custom range. At most 366 days, `from ≤ to`, not in the
future (the caller's time zone).

| Mode | Meaning | For October 2026 |
|---|---|---|
| `previous` (default) | Calendar month → the month before; month to date → the same days of last month (end clamped, e.g. 1–30 Mar → 1–28 Feb); any other range → the same number of days just before | September 2026 |
| `last_year` | Same dates a year earlier (29 Feb → 28 Feb) | October 2025 |
| `average` | Average of the 3 previous periods of the same shape. Periods with no entries at all are left out of the average | Jul–Sep 2026 |
| `custom` | Any range, any length | e.g. 1–15 Aug 2026 |
| `none` | No comparison | — |

If the baseline has no entries the report says "No entries in … to compare
with." and shows no deltas (never "+∞%"). The app resolves the same rules on
the phone (`app/lib/core/domain/report.dart`) to label the choices ("vs
September 2026") before anything is sent.

## The narrative

`agent/report-writer.ts`, one model call per report.
- **Input:** `reportFacts` (in `core/report-narrative.ts`): the sections as
  labels and display strings only. Entries appear as their matched merchant or
  category, never their note text; bills only by a known merchant name or
  their category.
- **Output:** `{ headline, summary, changes ≤ 4, suggestions ≤ 3 }`, JSON,
  checked with zod and length limits.
- **Number guard:** `numbersAllowed` (generalised from the insight phrasing
  guard): every number in the narrative must appear in the facts
  (`₹1,71,518.44` → `171518.44`, `12%` → `12`, trailing decimal zeros
  ignored). A violation is retried once with the error; a second violation,
  or a model error, falls back to `templateNarrative`, built in code, so a
  report always appears.
- **Model:** on-demand Generate and Refresh use the caller's Profile ›
  Assistant key (D-027, sent like `askAgent`; missing or unknown → default,
  malformed → `invalid-argument`). The monthly job uses the default
  `AGENT_MODEL`. The report stores `narrativeSource` (`model` / `template`),
  `model` and `modelLabel`; the screen shows "Written by Gemini Flash" or
  "Summary built from the figures".
- Never logged: the facts, the prompt and the narrative. Logs carry the
  report id, model, source, fallback reason, tokens and latency.

## Backend

| Piece | What |
|---|---|
| `generateReport` (callable) | `{ from, to, compare: { mode, from?, to? }, timeZone, model? }` → `{ reportId }`. Writes `homes/{homeId}/reports/{autoId}` (`kind: custom`) |
| `refreshReport` (callable) | `{ reportId, timeZone, model? }` → `{ reportId }`. Rebuilds in place for the same period and comparison; keeps `createdAt`/`createdBy`, sets `generatedAt`/`generatedBy` |
| `generateMonthlyReports` (scheduled) | `0 7 1 * *` Asia/Kolkata. Every home with entries last month, one at a time; one failing does not stop the rest. Stable id `monthly_YYYY-MM`, so a rerun updates it. One `report_ready` notification per member (doc id `report_<home>_<month>_<uid>`, created once). Links the month's `month_review` card (`data.reportId`). Deletes custom reports older than 180 days; monthly ones are kept |
| Limits | Generate + Refresh: 10 per user per India-time day (`aiRateLimits/{day}_{uid}.reportCalls`, counted before the model runs) → `resource-exhausted` |
| Usage | `aiUsage/{month}_{home}`: `reports`, `reportInputTokens`, `reportOutputTokens`; shown on the admin dashboard as "Reports" |
| Push | `onNotificationCreated` sends a notification with `recipientId` only to that member, with its `title`, and route `/reports/<id>` |
| By hand | `npm run monthly-report -- --project … --home <id> [--month YYYY-MM] [--execute]` (operations.md) |

Tunables are in `REPORTS` in `src/config.ts`. Schema: `backend/SCHEMA.md`.

## App

`app/lib/features/reports/`: `reports_screen.dart`, `new_report_sheet.dart`
(about 5–10 s with a progress line, then opens the report), `report_screen.dart`
(headline figures with change chips, narrative card, paired category bars, a
member split bar, weekly columns, notable entries that open the entry, bills,
budgets, tags; **Refresh** and **Ask about this report**). Data:
`ReportsRepository` in `core/data/repositories.dart`, Firebase in
`core/data/firebase/firebase_reports_repository.dart`, demo reports in
`demo_repository.dart`. Parsing is lenient: unknown sections and malformed
rows are skipped, so the server can add sections without breaking older
builds.

## Evaluation

`npm run eval:reports -- --model vertexai/gemini-3.8-flash,vertexai/gemini-3.5-flash-lite`
runs ten fixture reports (`eval/report-cases.ts`) through the writer and
records how often the guard passes first time, after the retry, or falls back
to the template, with latency and tokens. Billed (about 20–40 calls); not run
yet. The narratives go to the local results file for reading.

## Cost

One model call per report (two on a retry), about 3k input and 400 output
tokens on Flash: well under ₹1. Six households make six calls a month for the
monthly run.

## Later

A `generate_report` tool for the assistant; share or export as PDF;
Malayalam narrative (D-028 rules); a personal-only report.
