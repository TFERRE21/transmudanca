const {spawnSync}=require("node:child_process");
const fs=require("node:fs");
process.env.PLAYWRIGHT_BROWSERS_PATH="0";
(async()=>{
 const {chromium}=await import("playwright-core");
 const paths=[chromium.executablePath(),"/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome"].filter(fs.existsSync);
 if(!paths.length){console.error("Chromium nao encontrado.");process.exitCode=1;return}
 for(const executablePath of paths){
  console.log("Executavel:",executablePath);
  const ldd=spawnSync("ldd",[executablePath],{encoding:"utf8",timeout:8000});
  console.log("Bibliotecas ausentes:",(ldd.stdout||"").split("\n").filter(s=>s.includes("not found")).join("; ")||"Nenhuma identificada por ldd");
  let b;try{b=await chromium.launch({executablePath,headless:true,timeout:12000,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});console.log("Chromium iniciou com sucesso.");return}
  catch(e){console.error("Falha ao iniciar:",String(e.message).slice(-2400));process.exitCode=1}
  finally{await b?.close().catch(()=>{})}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
