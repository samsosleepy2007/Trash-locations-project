import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
await mkdir('assets', {recursive:true});
await rm('assets', {recursive:true,force:true});
await build({entryPoints:{motion:'src/motion.jsx',activities:'src/activities/main.jsx'},outdir:'assets',bundle:true,minify:true,splitting:true,format:'esm',jsx:'automatic',target:['es2020'],legalComments:'linked',define:{'process.env.NODE_ENV':'"production"'},entryNames:'[name]',chunkNames:'[name]-[hash]'});
