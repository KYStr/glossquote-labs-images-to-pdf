import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, requireNode } from './files.mjs';

requireNode();
const evidence = path.join(ROOT, 'evidence', 'm1');
await mkdir(evidence, { recursive: true });
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
await readFile(npmCli); // Only the installed CLI program, never authentication/configuration files.
const results = [];
for (const [name, args] of [['test', ['test']], ['check', ['run', 'check']], ['build', ['run', 'build']]]) {
  const run = spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  const stdout = run.stdout ?? '', stderr = run.stderr ?? '';
  await writeFile(path.join(evidence, `final-${name}.log`), stdout + stderr);
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = new RegExp(`(?:ℹ|#) ${key} (\\d+)`).exec(stdout);
    if (match) counts[key] = Number(match[1]);
  }
  results.push({ command: `npm ${args.join(' ')}`, executable: process.execPath, args: [npmCli, ...args], exit: run.status, signal: run.signal, counts, logSha256: createHash('sha256').update(stdout + stderr).digest('hex') });
  console.log(`${name}: exit ${run.status}${counts.tests ? `, ${counts.pass}/${counts.tests} pass` : ''}`);
  if (run.status !== 0) break;
}
await writeFile(path.join(evidence, 'final-commands.json'), JSON.stringify({ node: process.version, shell: false, windowsHide: true, results }, null, 2) + '\n');
if (results.length !== 3 || results.some(result => result.exit !== 0)) process.exitCode = 1;
