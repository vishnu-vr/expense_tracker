# Design system: "Ledger"

Chosen 2026-11-10 (D-006). Code: `app/lib/core/theme/ledger_theme.dart`,
`app/lib/core/widgets/common.dart`.

## Principles

- **Reads like an account book.** Big tabular figures, thin ink rules, lots of
  ground. Cards only where content is a self-contained tile.
- **One accent.** Deep green `#0B6E4F` for the single most important thing on
  a screen (the "Worth knowing" card, Confirm buttons, positive amounts).
  Danger and warning are reserved for budget states.
- **Numbers are sacred.** Money always goes through `formatMoney` /
  `Money` (`core/format/money.dart`): Indian grouping, `−` for expenses,
  and masking when "Hide amounts" is on, including inside free text
  (`Money.text`).

## Tokens (`LedgerPalette`)

| Token | Light | Dark | Use |
|---|---|---|---|
| ground | `#F4F5F2` | `#101312` | Page background |
| surface | `#FFFFFF` | `#191D1B` | Cards, inputs |
| ink | `#14171A` | `#F1F3EF` | Text, rules, primary buttons |
| muted | `#555D65` | `#A3ABA6` | Secondary text |
| line / track | `#D5D8D2` / `#E4E6E1` | `#2E3431` / `#272C2A` | Dividers / bar backgrounds |
| accent | `#0B6E4F` | `#0B6E4F` | Fills |
| positive | `#0B6E4F` | `#62D0A2` | Income text |
| danger / warning | `#A4321F` / `#8A5A00` | `#F08A75` / `#E5B45A` | Budget over / near |

Read colours with `context.palette`, never hard-code them in widgets.

## Type

`LedgerText.display` (Space Grotesk, tabular figures) for headings and
figures; `LedgerText.body` (Inter) for everything else; `LedgerText.eyebrow`
for the small uppercase labels above figures. Fonts are bundled in
`app/assets/fonts` (OFL licences alongside).

## Shared widgets

`LedgerCard`, `SectionTitle`, `ListRow`, `ProgressBar`, `Segmented`,
`PeriodNav`, `EmptyState`, `Pill`, `showToast`, `confirmDialog`,
`CategoryIcon`, `BurnSparklineView`. Use these before making new ones.

## Talk panel (D-028)

Replaces the Ask input while a voice conversation runs, so the thread stays
visible above it (proposals there are still confirmed by tap). Surface
colour with an ink top rule. One row: a 36 px round state badge (accent
fill with a mic while listening, track fill otherwise), the state in
`LedgerText.display(18)` (Listening, Thinking, Speaking, Paused; a live
region), and an outlined **End** button (44 px). Under it: the language
fallback note (12 px muted) when English is used instead of Malayalam, then
the live transcript, or a muted hint ("Ask a question, or say "stop" to
end.", "Tap to interrupt."). The whole panel is the tap target: tapping
interrupts speaking or pauses listening; paused shows a text field with the
transcript and **Listen again** / **Send**. The mic in the input row is an
icon button with tooltip **Talk**. While thinking, a short click repeats
instead of spoken status text.

## App icon

Off-white receipt with a torn edge, an ink rupee mark and two ledger rules
(the second in accent green), on accent green `#0B6E4F`. Master artwork:
`app/assets/icon/` (`app_icon.svg` full-bleed for iOS and stores,
`app_icon_foreground.svg` for the Android adaptive icon, `app_icon_monochrome.svg`
for Android 13 themed icons, `app_icon_1024.png`). Platform files were
rendered from these: `app/android/app/src/main/res/mipmap-*` and
`mipmap-anydpi-v26/ic_launcher.xml`, and
`app/ios/Runner/Assets.xcassets/AppIcon.appiconset` (no alpha channel). To
change it, edit the SVGs and regenerate every size.

## Rules of thumb

- Touch targets ≥ 44 px; icon-only buttons get a `tooltip` (it doubles as the
  accessibility label and the test finder).
- No `alert()`-style dialogs for feedback: toast for success, inline text for
  validation, `confirmDialog` only for destructive actions.
- Screens must survive 320 px width at 1.3× text. Home has a test for this
  (`app/test/features/home_screen_test.dart`); add one for any dense new screen.
- Category colour shows as a thin bar under the icon, not as a fill, so it
  never fights the palette.
