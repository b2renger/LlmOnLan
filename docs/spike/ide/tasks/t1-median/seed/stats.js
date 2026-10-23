// Small statistics helpers used by the report page.

function mean(values) {
    if (values.length === 0) return NaN;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

function median(values) {
    if (values.length === 0) return NaN;
    const sorted = values.slice().sort();
    const mid = Math.floor(sorted.length / 2);
    return sorted[mid];
}

function range(values) {
    if (values.length === 0) return NaN;
    return Math.max(...values) - Math.min(...values);
}

module.exports = { mean, median, range };
