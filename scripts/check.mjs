import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
let count=0;async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','.local','data'].includes(e.name))continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else if(/\.m?js$/.test(file)){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);count++;}}}await walk('.');console.log(`Syntax verified: ${count} JavaScript modules.`);
