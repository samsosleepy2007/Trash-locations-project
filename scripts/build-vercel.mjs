import {cp,mkdir,rm} from 'node:fs/promises';

await import('./build.mjs');
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});

for(const path of ['index.html','activity.html','admin.html','app.js','style.css','activity-config.js']){
  await cp(path,`dist/${path}`);
}
for(const path of ['assets','image']){
  await cp(path,`dist/${path}`,{recursive:true});
}
