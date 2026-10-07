import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { build } from 'esbuild';
fs.mkdirSync('dist', { recursive: true }); fs.mkdirSync('.build', { recursive: true }); fs.mkdirSync('evidence', { recursive: true });
const worker = await build({ entryPoints: ['src/worker.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, metafile: true, legalComments: 'inline' });
const source = worker.outputFiles[0].text; fs.writeFileSync('.build/worker.js', source);
const app = await build({ entryPoints: ['public/app.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, metafile: true, define: { WORKER_SOURCE: JSON.stringify(source), DEMO_MAP: JSON.stringify(fs.readFileSync('fixtures/demo-updated.mm', 'utf8')), DEMO_PRIOR: JSON.stringify(fs.readFileSync('fixtures/calc-7.3.7.2-annotated.xlsx').toString('base64')) } });
const packages = new Set(); for (const name of Object.keys(worker.metafile.inputs)) if (name.includes('node_modules/')) packages.add(name.split('node_modules/').at(-1).split('/')[0]);
if (JSON.stringify([...packages].sort()) !== JSON.stringify(['fflate', 'saxes', 'xmlchars'])) throw Error('Unexpected bundled packages');
const notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'), components = [];
for (const name of [...packages].sort()) {
 const dir = path.join('node_modules', name), pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
 const noticeFile = name === 'saxes' ? 'docs/saxes-license.txt' : ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(p => path.join(dir, p)).find(fs.existsSync); if (!noticeFile) throw Error('Missing notice');
 const notice = fs.readFileSync(noticeFile, 'utf8'); if (!notices.includes(notice.trim())) throw Error('Complete upstream notice missing: ' + name);
 components.push({ name, version: pkg.version, license: pkg.license, noticeSHA256: crypto.createHash('sha256').update(notice).digest('hex') });
}
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = fs.readFileSync('public/index.html', 'utf8').replace('/*APP_CSS*/', fs.readFileSync('public/style.css', 'utf8')).replace('/*THIRD_PARTY_NOTICES*/', escape(notices)).replace('/*APP_SCRIPT*/', app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync('dist/branchsheet.html', html);
fs.writeFileSync('evidence/worker-metafile.json', JSON.stringify(worker.metafile, null, 2) + '\n');
fs.writeFileSync('evidence/app-metafile.json', JSON.stringify(app.metafile, null, 2) + '\n');
fs.writeFileSync('evidence/bundled-components.json', JSON.stringify(components, null, 2) + '\n');
console.log(`Single-file offline app: ${Buffer.byteLength(html)} bytes; bundles ${[...packages].sort().join(', ')}`);
