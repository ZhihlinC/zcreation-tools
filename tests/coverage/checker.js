// Tiny assertion collector shared by the Node and browser test scripts.
'use strict';
function makeChecker(log = console.log) {
  const results = [];
  function check(name, cond, detail) {
    const ok = !!cond;
    results.push({ name, ok });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
    return ok;
  }
  function summary(label) {
    const passed = results.filter(r => r.ok).length;
    log(`\n${label}: ${passed}/${results.length} passed`);
    if (passed !== results.length) process.exitCode = 1;
    return { passed, total: results.length };
  }
  return { check, summary, results };
}
module.exports = { makeChecker };
