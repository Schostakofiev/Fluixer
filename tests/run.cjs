const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=fs.readdirSync(__dirname).filter(name=>/^test_.*\.cjs$/.test(name)&&name!=='test_browser.cjs').sort();
for(const name of files){const result=spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1)}
console.log(`PASS ${files.length} module test files`);
