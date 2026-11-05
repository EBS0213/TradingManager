/* Deterministic calculation checks; no remote feeds, price fixtures are synthetic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const file = path.join(__dirname, '../components/bloomberg/lib/volatility.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const scope = { exports: {} };
vm.runInNewContext(compiled, scope);
const calculate = scope.exports.calculateVolatilityMetrics;
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const history = (values, interval = 60000, start = Date.parse('2026-10-01T00:00:00Z')) => values.map((value, i) => ({ time: new Date(start + i * interval).toISOString(), value }));

const absent = calculate({});
assert.equal(absent.standardDeviationPct, null);
assert.equal(absent.rsi14, null);
assert.equal(absent.impliedVolatilityPct, null);
assert.equal(calculate({ history: history([100, 101]) }).standardDeviationPct, null);

const prices = [100, 100 * Math.exp(.01), 100];
const minute = calculate({ history: history(prices) });
assert.equal(minute.interval, 'intraday');
close(minute.standardDeviationPct, Math.sqrt(.0002) * 100);
assert.equal(minute.annualizedVolatilityPct, null);

const daily = calculate({ dailyHistory: history(prices, 86400000) });
assert.equal(daily.interval, 'daily');
assert.equal(daily.historySource, 'daily');
close(daily.annualizedVolatilityPct, Math.sqrt(.0002) * Math.sqrt(252) * 100);

const ohlc = calculate({ dailyHistory: history([100, 102, 105], 86400000).map(point => ({ ...point, high: 110, low: 100, isComplete: true })) });
close(ohlc.lastObservedDayRangePct, 10);
assert.equal(ohlc.rangeSource, 'daily-ohlc');

const incomplete = calculate({ dailyHistory: [...history([100, 102, 105], 86400000), { time: '2026-10-04', value: 500, high: 600, low: 5, isComplete: false }] });
assert.equal(incomplete.observations, 3);
assert.equal(incomplete.values.at(-1), 105);

const fallback = calculate({ dailyHistory: [{ time: '2026-10-01', value: 100 }], history: history([100, 101, 102]) });
assert.equal(fallback.interval, 'intraday');
assert.equal(fallback.historySource, 'intraday');

close(calculate({ history: history(Array(20).fill(100)) }).rsi14, 50);
close(calculate({ history: history(Array.from({ length: 20 }, (_, i) => 100 + i)) }).rsi14, 100);
close(calculate({ history: history(Array.from({ length: 20 }, (_, i) => 100 - i)) }).rsi14, 0);
assert.equal(calculate({ history: history(Array(14).fill(100)) }).rsi14, null);

const gaps = [...history(Array(11).fill(100)), ...history(Array(11).fill(200), 60000, Date.parse('2026-10-02T00:00:00Z'))];
const gapMetrics = calculate({ history: gaps });
assert.equal(gapMetrics.interval, 'intraday');
assert.equal(gapMetrics.returns, 20);
close(gapMetrics.standardDeviationPct, 0);

const weekly = calculate({ history: history([100, 101, 99, 102], 7 * 86400000) });
assert.equal(weekly.interval, 'irregular');
assert.equal(weekly.annualizedVolatilityPct, null);
const filtered = calculate({ history: [...history([100, 102, 105]), { time: 'bad-date', value: 20 }, { time: '2026-10-01T00:03:00Z', value: -1 }, { time: '2026-10-01T00:01:00Z', value: 102 }] });
assert.equal(filtered.observations, 3);
assert.equal(filtered.impliedVolatilityPct, null);
console.log('Terminal volatility checks passed: log-return sample deviation, daily-only annualization, OHLC ranges, Wilder RSI14, incomplete bars, overnight gaps, missing/invalid data.');
