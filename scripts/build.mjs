import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {build} from 'esbuild';

const root=path.resolve(import.meta.dirname,'..');
const output=await build({entryPoints:[path.join(root,'src/app.js')],bundle:true,format:'iife',target:['chrome110','safari17'],minify:true,write:false,legalComments:'eof'});
const bundle=output.outputFiles[0].contents;
const name='app.'+crypto.createHash('sha256').update(bundle).digest('hex').slice(0,12)+'.js';
// Previously published HTML can remain in a visitor's cache during an update.
// Its immutable, hashed bundle must stay available after the new release.
await fs.rm(path.join(root,'assets','app.js'),{force:true});
await fs.writeFile(path.join(root,'assets',name),bundle);
for(const file of ['index.html','tour.html','catalog.html','credits.html']){
  let html=await fs.readFile(path.join(root,'src',file),'utf8');
  if(file==='index.html')html=html.replace('src="./assets/app.js"','src="./assets/'+name+'"');
  if(/(?:src|href)="\/(?!\/)|["']\/assets\//.test(html))throw new Error('Root-absolute path in '+file);
  await fs.writeFile(path.join(root,file),html);
}
console.log(JSON.stringify({bundle:name,bundle_bytes:bundle.byteLength,hosting:'GitHub Pages project subdirectory',authentication:'none'}));
