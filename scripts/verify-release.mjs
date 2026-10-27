import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, requireNode } from './files.mjs';

requireNode();
const evidence = path.join(ROOT, 'evidence', 'm1b');
await mkdir(evidence, { recursive: true });
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
await readFile(npmCli);
const commands = [['test', ['test']], ['check', ['run', 'check']], ['build-release', ['run', 'build:release']], ['check-release', ['run', 'check:release']]];
const results = [];
for (const [name, args] of commands) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  await writeFile(path.join(evidence, `final-${name}.log`), log);
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = new RegExp(`(?:ℹ|#) ${key} (\\d+)`).exec(log);
    if (match) counts[key] = Number(match[1]);
  }
  results.push({ command: `npm ${args.join(' ')}`, executable: process.execPath, args: [npmCli, ...args], exit: result.status, signal: result.signal, counts, logSha256: createHash('sha256').update(log).digest('hex') });
  console.log(`${name}: exit ${result.status}${counts.tests ? `, ${counts.pass}/${counts.tests} pass` : ''}`);
  if (result.status !== 0) break;
}
await writeFile(path.join(evidence, 'final-commands.json'), JSON.stringify({ node: process.version, shell: false, windowsHide: true, results, browser: 'NOT_RUN_USER_FOCUS_INCIDENT', publication: 'NOT_AUTHORIZED_BY_M1B' }, null, 2) + '\n');
if (results.length !== commands.length || results.some(result => result.exit !== 0)) process.exitCode = 1;
