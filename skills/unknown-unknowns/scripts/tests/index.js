// Node 22 and later read `node --test scripts/tests` as the path of one module, so they run this
// file. It loads every test file. Node 18 and 20 search the folder and find the test files by name.
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const name of readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, name)).href);
}
