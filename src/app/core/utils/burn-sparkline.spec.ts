import { buildBurnSparkline } from './burn-sparkline';

describe('buildBurnSparkline', () => {
    it('returns empty when there is no spend', () => {
        const spark = buildBurnSparkline([0, 0, 0], 31, 0);
        expect(spark.hasData).toBeFalse();
        expect(spark.actualPath).toBe('');
        expect(spark.forecastPath).toBe('');
    });

    it('draws cumulative actual path and a forecast tail', () => {
        const spark = buildBurnSparkline([100, 50, 50], 10, 333.33);
        expect(spark.hasData).toBeTrue();
        expect(spark.actualPath.startsWith('M ')).toBeTrue();
        expect(spark.areaPath.endsWith(' Z')).toBeTrue();
        expect(spark.forecastPath.startsWith('M ')).toBeTrue();
        expect(spark.todayX).toBeGreaterThan(0);
        expect(spark.todayX).toBeLessThan(spark.width);
    });

    it('omits forecast when the month is fully elapsed', () => {
        const spark = buildBurnSparkline([10, 20, 30], 3, 60);
        expect(spark.hasData).toBeTrue();
        expect(spark.forecastPath).toBe('');
        expect(spark.todayX).toBeCloseTo(spark.width - 2, 0);
    });
});
