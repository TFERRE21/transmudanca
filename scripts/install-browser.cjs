// Instala o navegador e suas bibliotecas na fase npm postinstall.
// Sem desativar o site caso o ambiente de deploy não permita apt.
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const fs=require("node:fs");
const cli=path.join(__dirname,"..","node_modules","playwright-core","cli.js");
const base=path.join(__dirname,"..","node_modules","playwright-core",".local-browsers");
const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:"0",DEBIAN_FRONTEND:"noninteractive"};
function shells(){
 if(!fs.existsSync(base))return [];
 return fs.readdirSync(base).filter(n=>n.startsWith("chromium_headless_shell-"))
  .map(n=>path.join(base,n,"chrome-headless-shell-linux64","chrome-headless-shell")).filter(fs.existsSync);
}
function run(args,timeout){
 const result=spawnSync(process.execPath,[cli,...args],{env,stdio:"inherit",timeout});
 if(result.error||result.status!==0)console.warn("[chromium] Falha em "+args.join(" ")+": "+(result.error?.message||"exit "+result.status));
 return !result.error&&result.status===0;
}
if(!fs.existsSync(cli)){console.warn("[chromium] CLI Playwright ausente; site segue disponível.");process.exit(0)}
const prior=shells();
if(!prior.length)run(["install","chromium","--only-shell"],115000);
const executable=shells()[0];
if(!executable){console.warn("[chromium] Navegador indisponível após a tentativa de instalação.");process.exit(0)}
let missing=[];
try{
 const ldd=spawnSync("ldd",[executable],{encoding:"utf8",timeout:8000});
 missing=(ldd.stdout||"").split("\n").filter(line=>line.includes("not found"));
}catch(e){console.warn("[chromium] Não foi possível verificar bibliotecas:",e.message)}
if(!missing.length){console.log("[chromium] Navegador presente e bibliotecas verificadas.");process.exit(0)}
console.warn("[chromium] Faltam bibliotecas Linux: "+missing.map(x=>x.trim()).join("; "));
if(typeof process.getuid==="function"&&process.getuid()!==0){
 console.warn("[chromium] Postinstall sem root. Instale dependências na imagem Docker ou execute npm run setup:browser-deps como root no container.");
 process.exit(0);
}
run(["install-deps","chromium"],180000);
const final=spawnSync("ldd",[executable],{encoding:"utf8",timeout:8000});
const stillMissing=(final.stdout||"").split("\n").filter(line=>line.includes("not found"));
console.log(stillMissing.length?"[chromium] Bibliotecas ainda ausentes: "+stillMissing.map(x=>x.trim()).join("; "):"[chromium] Bibliotecas do Chromium instaladas com sucesso.");
process.exit(0);
