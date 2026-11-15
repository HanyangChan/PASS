import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from './scenarios/scenarios.mjs';
import { catalog, runners } from './scenarios/recommend-eval.mjs';

// Every conversation must reach the expected conditions and give safe, gift-like picks, identically on
// the guest device and through the server's rules-first mode A, for each catalog source the app can use.
for (const source of ['amazon', 'web', 'both']) {
  const { guestRun, serverRun, check } = runners(catalog(source));
  for (const [path, run] of [['guest', guestRun], ['server', serverRun]]) {
    test(`recommendation scenarios (${source}, ${path})`, async () => {
      const failures = [];
      for (const sc of SCENARIOS) {
        const errors = check(await run(sc.say), sc.expect);
        if (errors.length) failures.push(`${sc.say.join(' / ')}: ${errors.join('; ')}`);
      }
      assert.deepEqual(failures, []);
    });
  }
}
