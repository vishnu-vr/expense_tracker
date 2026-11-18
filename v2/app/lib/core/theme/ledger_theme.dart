import 'package:flutter/material.dart';

/// "Ledger" visual direction: off-white ground, ink rules, large tabular
/// numbers and a single deep-green accent. Colours live in a theme extension
/// so light and dark share every widget.
@immutable
class LedgerPalette extends ThemeExtension<LedgerPalette> {
  const LedgerPalette({
    required this.ground,
    required this.surface,
    required this.ink,
    required this.onInk,
    required this.muted,
    required this.line,
    required this.track,
    required this.accent,
    required this.onAccent,
    required this.onAccentMuted,
    required this.positive,
    required this.danger,
    required this.warning,
  });

  final Color ground;
  final Color surface;
  final Color ink;
  final Color onInk;
  final Color muted;
  final Color line;
  final Color track;

  /// Accent used as a fill (cards, buttons, bars).
  final Color accent;
  final Color onAccent;
  final Color onAccentMuted;

  /// Accent used as text on the ground (income amounts, "on track").
  final Color positive;
  final Color danger;
  final Color warning;

  static const light = LedgerPalette(
    ground: Color(0xFFF4F5F2),
    surface: Color(0xFFFFFFFF),
    ink: Color(0xFF14171A),
    onInk: Color(0xFFFFFFFF),
    muted: Color(0xFF555D65),
    line: Color(0xFFD5D8D2),
    track: Color(0xFFE4E6E1),
    accent: Color(0xFF0B6E4F),
    onAccent: Color(0xFFFFFFFF),
    onAccentMuted: Color(0xFFCDE9DD),
    positive: Color(0xFF0B6E4F),
    danger: Color(0xFFA4321F),
    warning: Color(0xFF8A5A00),
  );

  static const dark = LedgerPalette(
    ground: Color(0xFF101312),
    surface: Color(0xFF191D1B),
    ink: Color(0xFFF1F3EF),
    onInk: Color(0xFF101312),
    muted: Color(0xFFA3ABA6),
    line: Color(0xFF2E3431),
    track: Color(0xFF272C2A),
    accent: Color(0xFF0B6E4F),
    onAccent: Color(0xFFFFFFFF),
    onAccentMuted: Color(0xFFCDE9DD),
    positive: Color(0xFF62D0A2),
    danger: Color(0xFFF08A75),
    warning: Color(0xFFE5B45A),
  );

  @override
  LedgerPalette copyWith() => this;

  @override
  LedgerPalette lerp(ThemeExtension<LedgerPalette>? other, double t) =>
      other is LedgerPalette && t >= 0.5 ? other : this;
}

extension LedgerPaletteContext on BuildContext {
  LedgerPalette get palette => Theme.of(this).extension<LedgerPalette>()!;
}

class LedgerText {
  const LedgerText._();

  static const _tabular = [FontFeature.tabularFigures()];

  /// Body and label text (Inter). A null [color] inherits the theme's ink.
  static TextStyle body({
    double size = 15,
    int weight = 400,
    Color? color,
    double? height,
    double? letterSpacing,
    bool tabular = false,
  }) =>
      TextStyle(
        fontFamily: 'Inter',
        fontSize: size,
        fontWeight: FontWeight.values[(weight ~/ 100) - 1],
        fontVariations: [FontVariation('wght', weight.toDouble())],
        fontFeatures: tabular ? _tabular : null,
        color: color,
        height: height,
        letterSpacing: letterSpacing,
      );

  /// Headings and figures (Space Grotesk).
  static TextStyle display({
    double size = 20,
    int weight = 600,
    Color? color,
    double? height,
    double? letterSpacing,
  }) =>
      TextStyle(
        fontFamily: 'SpaceGrotesk',
        fontSize: size,
        fontWeight: FontWeight.values[(weight ~/ 100) - 1],
        fontVariations: [FontVariation('wght', weight.toDouble())],
        fontFeatures: _tabular,
        color: color,
        height: height,
        letterSpacing: letterSpacing,
      );

  /// Small uppercase label above a figure or section.
  static TextStyle eyebrow(Color color) =>
      body(size: 12, color: color, letterSpacing: 0.96);
}

ThemeData buildLedgerTheme(Brightness brightness) {
  final p = brightness == Brightness.dark ? LedgerPalette.dark : LedgerPalette.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.accent,
    onPrimary: p.onAccent,
    secondary: p.ink,
    onSecondary: p.onInk,
    error: p.danger,
    onError: p.ground,
    surface: p.ground,
    onSurface: p.ink,
    onSurfaceVariant: p.muted,
    outline: p.line,
    surfaceContainerHighest: p.track,
  );
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: c, width: w),
      );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    extensions: [p],
    scaffoldBackgroundColor: p.ground,
    fontFamily: 'Inter',
    textTheme: Typography.material2021(colorScheme: scheme).black.apply(
          fontFamily: 'Inter',
          bodyColor: p.ink,
          displayColor: p.ink,
        ),
    dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: p.ground,
      foregroundColor: p.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleSpacing: 4,
      titleTextStyle: LedgerText.display(color: p.ink),
      shape: Border(bottom: BorderSide(color: p.ink)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.surface,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: LedgerText.body(color: p.muted),
      labelStyle: LedgerText.body(color: p.muted),
      floatingLabelStyle: LedgerText.body(color: p.ink),
      border: border(p.line),
      enabledBorder: border(p.line),
      focusedBorder: border(p.ink, 1.5),
      errorBorder: border(p.danger),
      focusedErrorBorder: border(p.danger, 1.5),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.ink,
        foregroundColor: p.onInk,
        disabledBackgroundColor: p.track,
        disabledForegroundColor: p.muted,
        minimumSize: const Size(64, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: LedgerText.body(weight: 600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        side: BorderSide(color: p.ink),
        minimumSize: const Size(64, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: LedgerText.body(weight: 600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: const Size(44, 44),
        textStyle: LedgerText.body(size: 14, weight: 600),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: p.ink,
      contentTextStyle: LedgerText.body(size: 14, color: p.onInk),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.ground,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: p.line,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.ground,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      titleTextStyle: LedgerText.display(size: 18, color: p.ink),
      contentTextStyle: LedgerText.body(color: p.ink, height: 1.4),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.onAccent : p.muted),
      trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.accent : p.track),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
    datePickerTheme: DatePickerThemeData(backgroundColor: p.ground),
    timePickerTheme: TimePickerThemeData(backgroundColor: p.ground),
  );
}
