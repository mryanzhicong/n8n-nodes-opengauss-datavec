#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');

const pkgDir = path.join(__dirname, '..');
const ourLangchain = path.join(pkgDir, 'node_modules', '@langchain', 'core');

// Try to find n8n's @langchain/core via common relative paths
const candidates = [
    path.join(pkgDir, '..', 'n8n', 'node_modules', '@langchain', 'core'),
];

let target = null;
for (const c of candidates) {
    if (fs.existsSync(c)) { target = fs.realpathSync(c); break; }
}

if (!target) {
    console.warn('[setup:dev] n8n @langchain/core not found, skipping symlink');
    process.exit(0);
}

try {
    if (fs.existsSync(ourLangchain) || fs.lstatSync(ourLangchain).isSymbolicLink()) {
        fs.rmSync(ourLangchain, { recursive: true, force: true });
    }
} catch { /* ignore */ }

fs.symlinkSync(target, ourLangchain);
console.log(`[setup:dev] @langchain/core → ${target}`);
