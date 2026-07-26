const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..'),skip=new Set(['node_modules','.git','.codex-remote-attachments','.vscode']),files=[];
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(skip.has(entry.name))continue;const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.js'))files.push(file)}}
walk(root);
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(`${path.relative(root,file)}\n${result.stderr}`);process.exitCode=1}}
if(process.exitCode)process.exit(process.exitCode);
for(const htmlName of ['index.html','catalogo.html']){const html=fs.readFileSync(path.join(root,htmlName),'utf8');for(const match of html.matchAll(/(?:src|href)=["'](\.\/[^"'?#]+)/g)){const target=path.join(root,match[1]);if(!fs.existsSync(target)){console.error(`${htmlName}: arquivo ausente ${match[1]}`);process.exitCode=1}}}
if(process.argv.includes('--build')){
  const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  if(!/product-variations\.js/.test(worker)){
    console.error('service-worker.js: product-variations.js não está no cache offline');process.exitCode=1;
  }
  if(!/manifest\.json/.test(fs.readFileSync(path.join(root,'index.html'),'utf8'))){console.error('index.html: manifest ausente');process.exitCode=1}
}
if(!process.exitCode)console.log(`${process.argv.includes('--build')?'Build':'Lint'} validado: ${files.length} arquivos JavaScript.`);
