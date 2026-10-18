#!/usr/bin/env node
// Vercel build step: copies the page and the shared rules file into public/.
import { cpSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
mkdirSync(new URL('public/', root), { recursive: true });
cpSync(new URL('src/web/index.html', root), new URL('public/index.html', root));
cpSync(new URL('src/validator.js', root), new URL('public/validator.js', root));
console.log('Built public/index.html and public/validator.js');
