import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, requireNode } from '../../scripts/files.mjs';
import { archivePreviousRelease } from './archive-previous-release.mjs';

requireNode();
const evidence = path.join(ROOT, 'evidence/m2a');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await readFile(npmCli);
const commands = [
  { name: 'affected-tests', command: 'node --test test/release.test.mjs', args: ['--test', 'test/release.test.mjs'] },
  { name: 'check', command: 'npm run check', args: [npmCli, 'run', 'check'] },
  { name: 'build-release', command: 'npm run build:release', args: [npmCli, 'run', 'build:release'] },
  { name: 'check-release', command: 'npm run check:release', args: [npmCli, 'run', 'check:release'] },
];
const results = [];
for (const { name, command, args } of commands) {
  if (name === 'build-release') await archivePreviousRelease();
  const result = spawnSync(process.execPath, args, { cwd: ROOT, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  const logFile = `final-${name}.log`;
  await writeFile(path.join(evidence, logFile), log, { flag: 'wx' });
  const counts = {};
  for (const line of log.split(/\r?\n/)) {
    const match = /^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (match) counts[match[1]] = Number(match[2]);
  }
  results.push({ command, executable: process.execPath, args, exit: result.status, signal: result.signal, error: result.error?.code ?? null, counts, log: logFile, logSha256: createHash('sha256').update(log).digest('hex') });
  await writeFile(path.join(evidence, 'final-commands.json'), JSON.stringify({ task: 'B20-46-M2A', node: process.version, shell: false, windowsHide: true, results, browser: 'REUSED_PRIMARY_B20_46_R3; no browser run by M2A', publication: 'NOT_RUN_M2A_PREP_ONLY', deployment: 'NOT_RUN_M2A_PREP_ONLY' }, null, 2) + '\n');
  console.log(`${name}: exit ${result.status}${counts.tests ? `; ${counts.pass}/${counts.tests} PASS` : ''}`);
  if (result.status !== 0) { console.error(log); process.exitCode = 1; break; }
}
if (results.length !== commands.length || results.some(result => result.exit !== 0)) process.exitCode = 1;
