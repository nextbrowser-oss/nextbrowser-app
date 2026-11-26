// Receipts come from the desktop's workspace MCP. Model prose, stdout and
// unrelated successful shell calls cannot turn a failed test into a pass.
const testRunner = /^(?:(?:npm(?:\.cmd)?|pnpm|yarn|bun)\s+(?:(?:run(?:-script)?|exec)\s+)?(?:test(?:[:\w-]*)?|vitest|jest|playwright\s+test)\b|(?:npx\s+)?(?:vitest|jest|playwright\s+test)\b|node(?:\.exe)?\s+--test\b|(?:python[\d.]*|py)\s+-m\s+(?:pytest|unittest)\b|pytest\b|(?:go|cargo|dotnet|mvnw?|gradlew?|mix)\s+test\b|make\s+(?:test|check)\b|bundle\s+exec\s+rspec\b)/i;
function isTestCommand(command, request = '') {
  return typeof command === 'string' && !/[;&|\r\n<>]/.test(command) &&
    !/(?:^|\s)(?:--(?:help|version|list(?:tests)?|collect-only|dry-run)|-h)(?:\s|$)/i.test(command) &&
    (testRunner.test(command.trim().replace(/^(?:\.\/|\.\\)/, '')) ||
      /^(?:(?:node|python[\d.]*|bash|sh|pwsh\s+-File)\s+)?(?:\.?[/\\])?(?:[\w.-]+[/\\])*(?:test|run[-_]tests?|test[-_][\w.-]+)\.(?:[cm]?js|py|sh|ps1)(?:\s|$)/i.test(command.trim()) ||
      (/^(?:npm(?:\.cmd)?|pnpm|yarn|bun)\s+run\s+[\w:-]+$/.test(command.trim()) && request.includes('`' + command.trim() + '`')));
}
function createCodingVerification(request) {
  const ru = /[а-яё]/iu.test(request);
  const descriptive = /^(?:как\s|что\s|how (?:do|can|to|does)|what |explain |объясни|расскажи)/iu.test(request.trim());
  const omit = /(?:не\s+(?:запускай|проверяй|гони|надо запускать)|без\s+(?:запуска\s+)?тест|(?:don't|do not|without|skip)\s+(?:run(?:ning)?\s+)?(?:the\s+)?tests?)/iu.test(request);
  const requested = !omit && !descriptive && (/(?:запуст[иь]|прогон[ия]|прогони|проверь|провер[ьи]ть|проверкой|проверить)\s+[^.!?\n]{0,45}тест|с\s+тестами|протестируй\s+(?:код|проект|исправление)/iu.test(request) ||
    /\b(?:run|rerun|execute|verify|check|pass|using|with)\s+(?:[\w-]+\s+){0,4}(?:tests?|test suite)\b|\b(?:fix|implement)\b[^.!?\n]{0,80}\band test\b/i.test(request) ||
    /(?:run|запусти)\s+.{0,35}(?:pytest|node --test|npm test|cargo test|go test)/iu.test(request));
  const fix = !omit && !descriptive && /исправ|почини|реализуй|доработай|\b(?:fix|implement|repair|refactor)\b/iu.test(request);
  const files = new Set(), checks = new Map(), jobs = new Map(), otherJobs = new Set();
  let revision = 0;
  function record(name, args, result) {
    if (!name.startsWith('workspace_')) return;
    const data = result?.workspaceReceipt;
    const ok = data && !result.isError;
    if (['workspace_patch_file', 'workspace_write_text_file', 'workspace_create_directory'].includes(name)) {
      if (ok) { revision++; files.add(args.path); }
      return;
    }
    if (name === 'workspace_command_status') {
      if (ok && data.status !== 'running' && otherJobs.delete(args.job_id)) revision++;
      const check = jobs.get(args.job_id);
      if (check && ok && data.status !== 'running') {
        check.exit = data.exitCode;
        check.status = data.status === 'finished' && Number.isInteger(data.exitCode) ? 'finished' : 'stopped';
      }
      return;
    }
    if (name !== 'workspace_run_command') return;
    if (!isTestCommand(args.command, request)) {
      // A shell command can modify source outside the file tools. Keep a
      // passing receipt for simple read-only inspections such as git diff.
      if (ok && !/^(?:pwd|git\s+(?:diff|status|log|show)(?:\s+[\w./:=-]+)*)$/i.test((args.command || '').trim())) {
        revision++;
        if (data.status === 'running' && data.job_id) otherJobs.add(data.job_id);
      }
      return;
    }
    const command = args.command.trim(), key = (args.shell || '') + '\n' + command;
    const denied = result?.isError && /user denied|no saved approval|disabled for this workspace/i.test(result.text || '');
    const check = { command, revision, exit: data?.exitCode, status: denied ? 'denied' : 'stopped' };
    if (ok && data.status === 'running' && data.job_id) {
      check.status = 'running'; jobs.set(data.job_id, check);
    } else if (ok && Number.isInteger(data.exitCode)) check.status = 'finished';
    checks.set(key, check);
  }
  function report(answer = '') {
    const claimsPass = /\b(?:tests? (?:pass(?:ed)?|succeed(?:ed)?)|all tests (?:are )?green)\b|тесты\s+(?:(?:успешно|все)\s+)?(?:прошли|проходят|зел[её]ные)/iu.test(answer);
    if (!requested && !(fix && checks.size) && !(files.size && claimsPass)) return null;
    const lines = [];
    let verified = checks.size > 0 && otherJobs.size === 0;
    for (const check of checks.values()) {
      const stale = check.revision !== revision;
      verified &&= !stale && check.status === 'finished' && check.exit === 0;
      const status = check.status === 'denied' ? (ru ? 'нет разрешения на запуск' : 'permission denied') : check.status === 'finished' ? (ru ? 'код выхода ' : 'exit code ') + check.exit
        : check.status === 'running' ? (ru ? 'выполняется' : 'running') : (ru ? 'результат не получен' : 'no exit code');
      lines.push(check.command + ' — ' + status + (stale ? (ru ? ' (до последнего изменения)' : ' (before the latest change)') : ''));
    }
    if (!lines.length) lines.push(ru ? 'Запуск тестов не подтверждён.' : 'No test run was verified.');
    if (otherJobs.size) lines.push(ru ? 'Есть фоновая команда без подтверждённого завершения.' : 'A workspace command has no confirmed exit yet.');
    const heading = verified ? (ru ? 'Проверка пройдена.' : 'Verification passed.') : (ru ? 'Проверка не пройдена.' : 'Verification incomplete.');
    if (files.size) lines.unshift((ru ? 'Изменены файлы: ' : 'Changed files: ') + [...files].join(', '));
    return { verified, denied: [...checks.values()].some(check => check.status === 'denied'), text: heading + '\n\n' + lines.map(line => '- ' + line).join('\n') };
  }
  return { record, report };
}
module.exports = { createCodingVerification, isTestCommand };
