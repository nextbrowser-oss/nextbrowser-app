const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodingVerification, isTestCommand } = require('./coding-verification.cjs');

test('acknowledges project test scripts and excludes help, unrelated commands and masked failures', () => {
  assert.ok(isTestCommand('python -m pytest tests'));
  assert.ok(isTestCommand('./scripts/run-tests.sh'));
  assert.ok(isTestCommand('npm run ci', 'Run tests using `npm run ci`'));
  for (const command of ['echo tests passed', 'node --test || true', 'pytest --collect-only', 'npm run ci']) {
    assert.equal(isTestCommand(command), false);
  }
});

test('ordinary questions and requests to skip tests can finish without running commands', () => {
  for (const request of ['Как запустить тесты?', 'Исправь отступы, не запускай тесты.', 'Explain how to run the tests.']) {
    assert.equal(createCodingVerification(request).report(), null);
  }
});

test('one passing suite cannot clear a different failure; a denial is surfaced without requesting another approval', () => {
  const verification = createCodingVerification('Fix the project and run the tests.');
  const check = (command, exitCode) => verification.record('workspace_run_command', { command }, { workspaceReceipt: { exitCode } });
  check('npm test', 1);
  check('node --test sample.test.js', 0);
  assert.equal(verification.report().verified, false);
  verification.record('workspace_run_command', { command: 'npm test' }, { isError: true, text: 'The user denied this request.' });
  assert.equal(verification.report().denied, true);
});
