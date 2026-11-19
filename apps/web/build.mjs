import { mkdirSync, cpSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('index.html', 'dist/index.html');
