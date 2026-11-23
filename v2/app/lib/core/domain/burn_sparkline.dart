/// Geometry for the cumulative-spend sparkline with a month-end forecast tail.
/// Ported from `src/app/core/utils/burn-sparkline.ts`. The original produced
/// SVG path strings; this returns points so a CustomPainter or chart can draw
/// them. Display only: it does not change the burn-rate formulas.
library;

import 'dart:math' as math;

typedef SparkPoint = ({double x, double y});

class BurnSparkline {
  const BurnSparkline({
    required this.hasData,
    required this.actual,
    required this.forecast,
    required this.today,
    required this.baselineY,
    required this.width,
    required this.height,
  });

  final bool hasData;

  /// Cumulative spend from day 0 to today. Empty when there is no data.
  final List<SparkPoint> actual;

  /// Two points (today, month end) or empty when the month is fully elapsed.
  final List<SparkPoint> forecast;
  final SparkPoint today;

  /// Y coordinate of zero spend, for closing the filled area.
  final double baselineY;
  final double width;
  final double height;
}

const double _padX = 2;
const double _padY = 4;

BurnSparkline buildBurnSparkline(
  List<double> dailySpend,
  int totalDays,
  double monthEndForecast, {
  double width = 200,
  double height = 48,
}) {
  final baselineY = height - _padY;
  final empty = BurnSparkline(
    hasData: false,
    actual: const [],
    forecast: const [],
    today: (x: _padX, y: baselineY),
    baselineY: baselineY,
    width: width,
    height: height,
  );

  final daysElapsed = dailySpend.length;
  if (daysElapsed <= 0 || totalDays <= 0) return empty;

  final cumulative = <double>[];
  var running = 0.0;
  for (final amount in dailySpend) {
    running += amount;
    cumulative.add(running);
  }
  if (running <= 0) return empty;

  final maxY = math.max(math.max(monthEndForecast, running), 1.0);
  final innerW = width - _padX * 2;
  final innerH = height - _padY * 2;
  SparkPoint pt(num day, double value) => (
        x: _padX + (day / totalDays) * innerW,
        y: _padY + (1 - value / maxY) * innerH,
      );

  final actual = <SparkPoint>[pt(0, 0)];
  for (var i = 0; i < cumulative.length; i++) {
    actual.add(pt(i + 1, cumulative[i]));
  }

  final forecast = <SparkPoint>[];
  if (daysElapsed < totalDays && monthEndForecast > 0) {
    forecast
      ..add(actual.last)
      ..add(pt(totalDays, monthEndForecast));
  }

  return BurnSparkline(
    hasData: true,
    actual: actual,
    forecast: forecast,
    today: actual.last,
    baselineY: baselineY,
    width: width,
    height: height,
  );
}
