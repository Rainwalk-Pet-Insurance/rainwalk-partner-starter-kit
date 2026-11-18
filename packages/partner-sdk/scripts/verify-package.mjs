import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Test the distributable rather than relying on workspace resolution.
const directory = mkdtempSync(join(tmpdir(), 'rainwalk-sdk-package-'));
const env = { ...process.env, npm_config_cache: join(directory, 'npm-cache') };
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', directory], { encoding: 'utf8', env }));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, pack.filename)], { cwd: directory, stdio: 'pipe', env });
  writeFileSync(join(directory, 'smoke.mjs'), "import { RainwalkClient } from '@rainwalk/partner-sdk'; new RainwalkClient({apiKey:'synthetic',environment:'sandbox'});\n");
  writeFileSync(join(directory, 'smoke.cjs'), "const { RainwalkClient } = require('@rainwalk/partner-sdk'); new RainwalkClient({apiKey:'synthetic',environment:'sandbox'});\n");
  writeFileSync(join(directory, 'smoke.ts'), "import { RainwalkClient, type QuoteRequest, type PlanSelectionRequest, type BindRequest, createStripePaymentReference } from '@rainwalk/partner-sdk'; const sdk = new RainwalkClient({apiKey:'synthetic',environment:'sandbox'}); const body: QuoteRequest = { policyholder: {first_name:'Ava',last_name:'Ng',email:'ava@example.test',phone:'2125550123',address:{state:'TX',postal_code:'78701'}}, pet:{name:'Mochi',species:'dog',breed:'Mixed Breed',sex:'female',birth_date:'2022-05-14'},coverage_preferences:{annual_limit:5000,deductible:500,reimbursement_percent:80}}; const selection: PlanSelectionRequest = {offer_id:'22222222-2222-4222-8222-222222222222',billing_frequency:'monthly'}; const reference = createStripePaymentReference({accountReference:'test-account',customerReference:'cus_Test',paymentMethodReference:'pm_Test',type:'card'}); const bind: BindRequest = {quote_id:'11111111-1111-4111-8111-111111111111',plan_selection_id:'33333333-3333-4333-8333-333333333333',payment_method_id:'44444444-4444-4444-8444-444444444444',consent:{accepted_at:'2026-11-17T22:00:00Z',terms_version:'synthetic-test'}}; void sdk.selectPlan; void sdk.registerPaymentMethodReference; void sdk.createBind; void sdk.getPaymentMethod; void sdk.listPaymentMethods; void sdk.getBind; void sdk.getPolicy; void sdk.listPolicies; void bind; void reference; void selection; void body;\n");
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: directory });
  execFileSync(process.execPath, ['smoke.cjs'], { cwd: directory });
  execFileSync(process.execPath, [resolve('../../node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2023', '--module', 'NodeNext', 'smoke.ts'], { cwd: directory, stdio: 'inherit' });
  console.log('Packed SDK: JavaScript ESM, CommonJS, and TypeScript consumers passed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
