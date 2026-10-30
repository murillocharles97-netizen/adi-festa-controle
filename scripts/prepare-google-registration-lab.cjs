'use strict';
// Local static preparation only. No deploy, cloud configuration or credential read.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),target=path.join(root,'docs/qa/google-v216/registration-only/public');
const files=[['js/google-registration-client.js','js/google-registration-client.js'],['js/google-registration-dialog.js','js/google-registration-dialog.js'],['js/google-identity-picker.js','js/google-identity-picker.js'],['js/veconi-brand.js','js/veconi-brand.js'],['assets/veconi-symbol.svg','assets/veconi-symbol.svg'],['assets/veconi-icon-192-v133.png','assets/icon-192.png'],['assets/veconi-icon-512-v133.png','assets/icon-512.png']];
for(const[from,to]of files){const data=fs.readFileSync(path.join(root,from)),dest=path.join(target,to);fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(dest)&&crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==crypto.createHash('sha256').update(data).digest('hex'))throw Error('Static QA source changed; inspect '+to);if(!fs.existsSync(dest))fs.writeFileSync(dest,data,{flag:'wx'});}
console.log(JSON.stringify({localOnly:true,googleEnabled:JSON.parse(fs.readFileSync(path.join(target,'config.json'))).enabled,filesCopied:files.length,productionRequests:0}));
