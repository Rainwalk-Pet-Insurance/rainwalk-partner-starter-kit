import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { archiveRoot, buildStarterKit, repositoryRoot } from './build-release.mjs';
import { validateReleaseVersion } from './check-release-version.mjs';

test('a release requires matching stable tag, workspace versions and example dependency', () => {
  const root = {version:'0.1.0'}, sdk = {name:'@rainwalk/partner-sdk',version:'0.1.0'};
  const app = {version:'0.1.0',dependencies:{'@rainwalk/partner-sdk':'0.1.0'}};
  validateReleaseVersion('v0.1.0',root,sdk,app);
  for (const tag of ['main','v0.2.0','v0.1.0; echo unsafe','v0.1.0-beta.1']) assert.throws(() => validateReleaseVersion(tag,root,sdk,app));
  assert.throws(() => validateReleaseVersion('v0.1.0',root,sdk,{...app,version:'0.0.9'}));
  assert.throws(() => validateReleaseVersion('v0.1.0',root,sdk,{...app,dependencies:{'@rainwalk/partner-sdk':'0.0.9'}}));
});

test('versioned ZIP contains only reviewed sources, resolves guide links and rejects credential contamination/symlinks', async t => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'rainwalk-public-kit-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = resolve(temporary, 'source');
  const secret = `do-not-publish-${randomUUID()}`;
  const sources = JSON.parse(await readFile(resolve(repositoryRoot,'release-files.json'),'utf8'));
  for (const source of sources) {
    await mkdir(dirname(resolve(root,source)),{recursive:true});
    await writeFile(resolve(root,source),await readFile(resolve(repositoryRoot,source)));
  }
  for (const name of ['.env','examples/partner-quickstart/.env.local','examples/partner-quickstart/.next/server.js','packages/partner-sdk/dist/index.js','node_modules/private.json','.git/config']) {
    await mkdir(dirname(resolve(root,name)),{recursive:true}); await writeFile(resolve(root,name),secret);
  }
  const version = JSON.parse(await readFile(resolve(root,'packages/partner-sdk/package.json'),'utf8')).version;
  const archiveName = `rainwalk-partner-starter-kit-${version}.zip`;
  const result = await buildStarterKit({root,output:resolve(temporary,'release')});
  assert.equal(result.path.split('/').at(-1),archiveName);
  const bytes = await readFile(result.path); const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), [...sources,'starter-kit-manifest.json'].map(p=>`${archiveRoot}/${p}`).sort());
  const text = name => Buffer.from(files[`${archiveRoot}/${name}`]).toString('utf8');
  const manifest = JSON.parse(text('starter-kit-manifest.json'));
  assert.equal(manifest.sdk_version,version);
  for (const [name,hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(files[`${archiveRoot}/${name}`]).digest('hex'),hash);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await readFile(`${result.path}.sha256`,'utf8'),`${sha}  ${archiveName}\n`);
  for (const content of Object.values(files)) assert(!Buffer.from(content).includes(secret));
  for (const name of sources.filter(n=>n.endsWith('.md'))) {
    for (const [,href] of text(name).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(href)) continue;
      assert(files[`${archiveRoot}${resolve('/',dirname(name),href)}`],`Missing guide target: ${name} -> ${href}`);
    }
  }
  assert.match(text('LICENSE'),/MIT License/);
  assert.equal(text('packages/partner-sdk/LICENSE'),text('LICENSE'));
  const example = resolve(root,'examples/partner-quickstart/.env.example');
  await rm(example); await symlink(resolve(root,'examples/partner-quickstart/.env.local'),example);
  await assert.rejects(buildStarterKit({root,output:resolve(temporary,'release')}),/cannot be a symlink/);
  await assert.rejects(buildStarterKit({root:resolve(temporary,'missing')}),/ENOENT/);
});
