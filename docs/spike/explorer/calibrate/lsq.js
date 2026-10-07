module.exports = function lstsq(A, y) { const n = A[0].length; const M = [...Array(n)].map((_, i) => [...Array(n)].map((_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  const v = [...Array(n)].map((_, i) => A.reduce((s, r, k) => s + r[i] * y[k], 0));
  for (let i = 0; i < n; i++) { let p = i; for (let r = i; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = 0; c < n; c++) M[r][c] -= f * M[i][c]; v[r] -= f * v[i]; } }
  return v.map((x, i) => x / M[i][i]); };
