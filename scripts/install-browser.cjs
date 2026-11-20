// Instalacao opcional do navegador para leitura de paginas publicas renderizadas.
// Uma falha no download NAO pode impedir a inicializacao do site.
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const fs=require("node:fs");
const cli=path.join(__dirname,"..","node_modules","playwright-core","cli.js");
if(!fs.existsSync(cli)){console.warn("[chromium] Playwright CLI indisponivel; instalacao ignorada.");process.exit(0)}
const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:"0"};
console.log("[chromium] Instalando somente Chromium headless shell no diretorio do projeto...");
const result=spawnSync(process.execPath,[cli,"install","chromium","--only-shell"],{env,stdio:"inherit",timeout:115000});
if(result.error||result.status!==0){
 console.warn("[chromium] Nao foi possivel instalar o navegador neste ambiente. Site continua disponivel. Verifique permissao de download, tempo e dependencias Linux.",result.error?.message||result.status);
}else{console.log("[chromium] Instalacao concluida.");}
process.exit(0);
