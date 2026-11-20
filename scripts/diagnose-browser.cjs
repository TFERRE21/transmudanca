const {spawnSync}=require("node:child_process");
const fs=require("node:fs");
const path=require("node:path");
process.env.PLAYWRIGHT_BROWSERS_PATH="0";
(async()=>{
 const {chromium}=await import("playwright-core");
 const base=path.join(process.cwd(),"node_modules","playwright-core",".local-browsers");
 const shells=fs.existsSync(base)?fs.readdirSync(base).filter(v=>v.startsWith("chromium_headless_shell-")).flatMap(dir=>[
  path.join(base,dir,"chrome-headless-shell-linux64","chrome-headless-shell"),
  path.join(base,dir,"chrome-headless-shell-linux64","headless_shell")
 ]).filter(fs.existsSync):[];
 const paths=[...new Set([...shells,chromium.executablePath(),"/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome"].filter(fs.existsSync))];
 if(!paths.length){console.error("Nenhum Chromium executavel encontrado.");process.exitCode=1;return}
 for(const executablePath of paths){
  console.log("Executavel encontrado:",executablePath);
  const ldd=spawnSync("ldd",[executablePath],{encoding:"utf8",timeout:8000});
  console.log("Bibliotecas ausentes:",(ldd.stdout||"").split("\n").filter(s=>s.includes("not found")).join("; ")||"Nenhuma identificada pelo ldd");
  let browser;
  try{
   browser=await chromium.launch({executablePath,headless:true,timeout:15000,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
   console.log("Chromium iniciou com sucesso.");
   process.exitCode=0;return;
  }catch(e){console.error("Falha ao iniciar:",String(e.message).slice(-3500));process.exitCode=1}
  finally{await browser?.close().catch(()=>{})}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
