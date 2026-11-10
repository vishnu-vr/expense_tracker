import 'package:flutter/material.dart';

import '../domain/burn_sparkline.dart';
import '../theme/ledger_theme.dart';

/// Cumulative spend so far (solid) with a dashed line to the month-end forecast.
class BurnSparklineView extends StatelessWidget {
  const BurnSparklineView({
    super.key,
    required this.dailySpend,
    required this.totalDays,
    required this.monthEndForecast,
    this.height = 34,
  });

  final List<double> dailySpend;
  final int totalDays;
  final double monthEndForecast;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: SizedBox(
        height: height,
        width: double.infinity,
        child: CustomPaint(
          painter: _SparkPainter(dailySpend, totalDays, monthEndForecast,
              context.palette.ink, context.palette.track),
        ),
      ),
    );
  }
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.dailySpend, this.totalDays, this.forecast, this.ink, this.track);

  final List<double> dailySpend;
  final int totalDays;
  final double forecast;
  final Color ink;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final spark = buildBurnSparkline(dailySpend, totalDays, forecast,
        width: size.width, height: size.height);
    final paint = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeJoin = StrokeJoin.round;

    if (!spark.hasData) {
      canvas.drawLine(Offset(0, spark.baselineY),
          Offset(size.width, spark.baselineY), paint..color = track);
      return;
    }

    final path = Path()..moveTo(spark.actual.first.x, spark.actual.first.y);
    for (final p in spark.actual.skip(1)) {
      path.lineTo(p.x, p.y);
    }
    canvas.drawPath(path, paint);

    if (spark.forecast.length == 2) {
      final a = Offset(spark.forecast[0].x, spark.forecast[0].y);
      final b = Offset(spark.forecast[1].x, spark.forecast[1].y);
      final length = (b - a).distance;
      if (length > 0) {
        final dir = (b - a) / length;
        for (var d = 0.0; d < length; d += 7) {
          final end = (d + 3).clamp(0, length).toDouble();
          canvas.drawLine(a + dir * d, a + dir * end, paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(_SparkPainter old) =>
      old.dailySpend != dailySpend ||
      old.totalDays != totalDays ||
      old.forecast != forecast ||
      old.ink != ink;
}
