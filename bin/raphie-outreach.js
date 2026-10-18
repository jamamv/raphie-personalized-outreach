#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
