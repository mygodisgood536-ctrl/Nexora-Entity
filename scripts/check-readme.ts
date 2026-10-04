import { readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_SECTIONS = [
  { heading: 'Architecture', marker: /^##\s+Architecture/m },
  { heading: 'Getting started', marker: /^##\s+Getting started/m },
  { heading: 'Environment variables', marker: /^##\s+Environment variables/m },
  { heading: 'How verification works', marker: /^##\s+How verification works/m },
  { heading: 'Deployment', marker: /^##\s+Deployment/m },
  { heading: 'Google and search engines', marker: /^##\s+Google and search engines/m },
];

const text = readFileSync(path.resolve('README.md'), 'utf8');

const missing = REQUIRED_SECTIONS.filter((s) => !s.marker.test(text)).map((s) => s.heading);

const problems = [];
if (missing.length > 0) problems.push(`missing sections: ${missing.join(', ')}`);
if (text.length < 2000) problems.push('README is too short to document the system');

for (const cmd of ['npm install', 'npm run services', 'npm run build', 'npm run smoke', 'npm run verify']) {
  if (!text.includes(cmd)) problems.push(`does not document: ${cmd}`);
}

if (problems.length > 0) {
  console.log('README CHECK FAILED');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

console.log(`README CHECK OK (${text.length} chars, ${REQUIRED_SECTIONS.length} sections)`);