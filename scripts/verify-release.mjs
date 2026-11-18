import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { archiveRoot, buildStarterKit, repositoryRoot } from './build-release.mjs';
const sourceFiles = JSON.parse(await readFile(resolve(repositoryRoot, 'release-files.json'), 'utf8'));

const temporary = await mkdtemp(resolve(tmpdir(), 'rainwalk-downloaded-kit-'));
try {
  const archive = await buildStarterKit({ output: resolve(temporary, 'download') });
  const files = unzipSync(await readFile(archive.path));
  const allowed = new Set([...sourceFiles, 'starter-kit-manifest.json'].map(p => `${archiveRoot}/${p}`));
  for (const [name, content] of Object.entries(files)) {
    if (!allowed.has(name)) throw new Error(`Unexpected archive entry: ${name}`);
    const target = resolve(temporary, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const cwd = resolve(temporary, archiveRoot);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1', NEXT_TELEMETRY_DISABLED: '1' };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, env, stdio: 'inherit' });
  execFileSync(npm, ['run', 'check:partner'], { cwd, env, stdio: 'inherit' });
  console.log(`Downloaded ${archive.path.split('/').at(-1)}: clean install and all starter kit checks passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
