export interface BurnSparkline {
    hasData: boolean;
    areaPath: string;
    actualPath: string;
    forecastPath: string;
    todayX: number;
    todayY: number;
    width: number;
    height: number;
}

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 48;
const PAD_X = 2;
const PAD_Y = 4;

/**
 * Builds SVG paths for a cumulative spend sparkline with a dashed month-end forecast.
 * Display-only: does not change burn-rate formulas.
 */
export function buildBurnSparkline(
    dailySpend: number[],
    totalDays: number,
    monthEndForecast: number,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT
): BurnSparkline {
    const empty: BurnSparkline = {
        hasData: false,
        areaPath: '',
        actualPath: '',
        forecastPath: '',
        todayX: PAD_X,
        todayY: height - PAD_Y,
        width,
        height
    };

    const daysElapsed = dailySpend.length;
    if (daysElapsed <= 0 || totalDays <= 0) return empty;

    const cumulative: number[] = [];
    let running = 0;
    for (const amount of dailySpend) {
        running += amount;
        cumulative.push(running);
    }
    if (running <= 0) return empty;

    const maxY = Math.max(monthEndForecast, running, 1);
    const innerW = width - PAD_X * 2;
    const innerH = height - PAD_Y * 2;
    const xAt = (day: number) => PAD_X + (day / totalDays) * innerW;
    const yAt = (value: number) => PAD_Y + (1 - value / maxY) * innerH;
    const pt = (day: number, value: number) => `${xAt(day).toFixed(1)},${yAt(value).toFixed(1)}`;

    const actualPts = [pt(0, 0)];
    for (let i = 0; i < cumulative.length; i++) {
        actualPts.push(pt(i + 1, cumulative[i]));
    }

    const todayX = xAt(daysElapsed);
    const todayY = yAt(running);
    const lastActual = actualPts[actualPts.length - 1];
    const actualPath = `M ${actualPts.join(' L ')}`;
    const areaPath = `M ${pt(0, 0)} L ${actualPts.slice(1).join(' L ')} L ${todayX.toFixed(1)},${(height - PAD_Y).toFixed(1)} L ${PAD_X.toFixed(1)},${(height - PAD_Y).toFixed(1)} Z`;

    let forecastPath = '';
    if (daysElapsed < totalDays && monthEndForecast > 0) {
        forecastPath = `M ${lastActual} L ${pt(totalDays, monthEndForecast)}`;
    }

    return {
        hasData: true,
        areaPath,
        actualPath,
        forecastPath,
        todayX,
        todayY,
        width,
        height
    };
}
