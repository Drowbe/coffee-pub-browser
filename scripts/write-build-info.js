'use strict';

// Records the current git commit into src/build-info.json so the app can show
// which revision is running. Runs before `npm start` and before packaging.
// Packaged apps have no .git directory, so the file is the only source.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const target = path.join(root, 'src', 'build-info.json');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (err) {
    return '';
  }
}

const commit = git('rev-parse --short HEAD') || 'unknown';
const branch = git('rev-parse --abbrev-ref HEAD') || '';
const dirty = git('status --porcelain') !== '';
const info = { commit, branch, dirty, builtAt: new Date().toISOString() };

fs.writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: ${commit}${dirty ? ' (modified)' : ''}${branch ? ` on ${branch}` : ''}`);
