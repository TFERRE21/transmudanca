import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";
import {existsSync,readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";

const dir=process.env.ADMIN_DATA_DIR||"/data/mudancas-brasil";
const storage=path.join(dir,"captacao.json");
const terms=[
 '"serviço de mudança" "transporte" licitação',
 '"transporte de mobiliário" contratação',
 '"transporte de bens móveis" licitação',
 '"serviços de mudança" contratação',
 '"transporte de móveis" frete orçamento',
 '"mudança residencial" transportadora orçamento',
 '"transporte de equipamentos" remoção licitação',
 '"mudança de sede" transporte mobiliário',
 '"transporte de carga" "móveis" licitação'
];
const interval=6*60*60*1000;
let active=false, lastError="",lastRun=null, nextRun=null;
const esc=s=>String(s??"").trim().slice(0,700);
const decode=s=>String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const tag=(s,t)=>decode(s.match(new RegExp("<"+t+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+t+">","i"))?.[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
// Seleção conservadora: só serviços reais de transporte, não notícias contendo a palavra "mudança".
const normalize=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function classify(item){
 const title=normalize(item.title),search=normalize(item.term),combined=title+" "+search;
 const exclusion=/plano moretti|reforma (politica|tributaria)|mudanca (na|de) (lei|legislacao|governo|governanca|politica|economia|ministerio)|alteracao contratual|alteracao de empresa|junta comercial|passo a passo|especialistas dao dicas|dicas para organizar|como fazer mudanca|transporte publico|tarifa de onibus|rodoviario de passageiros|transito|mobilidade urbana|reajuste|transportes metropolitanos|mudanca climatica|mudanca de horario|mudanca na gestao|mudanca de presidente/;
 if(exclusion.test(title))return null;
 const transport=/\b(transporte|transportadora|transportar|frete|carreto|remocao|logistica|mudancas residenciais|mudanca residencial|mudancas comerciais|servicos de mudanca|servico de mudanca)\b/;
 const objects=/\b(mobiliario|moveis|bens moveis|bens patrimoniais|bens permanentes|equipamentos|acervo|arquivos|residencia|residencial|comercial|sede|escritorio|mudancas|mudanca|carga|mercadorias|objetos)\b/;
 const service=/\b(contratacao|contratar|licitacao|pregao|edital|dispensa|cotacao|proposta|orçamento|orcamento|solicita|solicitacao|precisa|procura|servicos|servico|empresa especializada|chamamento|registro de precos|abertura|transporte de mudanca|frete|carreto|transportadora)\b/;
 // Os três sinais devem estar no título: não aceitar só porque a busca usou as palavras.
 if(!transport.test(title)||!objects.test(title)||!service.test(title))return null;
 // Uma notícia sobre "licitação de mobiliário" sem transporte não passa no teste acima.
 const bid=/\b(licitacao|pregao|edital|dispensa|contratacao|registro de precos|cotacao publica|chamamento)\b/.test(title);
 const category=bid?"licitacao":/\b(equipamentos|arquivos|acervo|bens patrimoniais|bens permanentes)\b/.test(title)?"bens_e_equipamentos":/\b(residencia|residencial|mudanca residencial|frete|carreto)\b/.test(title)?"mudanca_residencial":"transporte_mobiliario";
 return {category,reason:"Serviço de transporte de bens/móveis identificado no título; confirmar detalhes na fonte."};
}
const recent=item=>{const d=Date.parse(item.publishedAt);return !Number.isFinite(d)||(d>=Date.now()-180*86400000&&d<=Date.now()+2*86400000)};
const relevant=item=>!!classify(item)&&recent(item);

const leadQueries=[
 '"preciso de frete" "mudança" Brasília',
 '"procuro transportadora" "mudança" DF',
 '"preciso de caminhão" "mudança" Goiás',
 '"solicito orçamento" "transporte de móveis"',
 '"preciso transportar móveis" frete',
 '"procuro frete" "móveis" Minas Gerais',
 '"preciso de mudança" "Brasília"',
 '"transporte de mobiliário" "solicito"'
];
const leadRequest=/\b(preciso|procuro|procurando|busco|necessito|solicito|quero contratar|cotacao|orcamento|pedido de frete|frete disponivel|carga disponivel)\b/;
const leadTransport=/\b(mudanca|mudancas|mobiliario|moveis|transportar|transporte|frete|carreto|caminhao|bens)\b/;
const leadReject=/\b(como fazer|dicas|noticia|noticias|guia|blog|curso|emprego|vagas|passo a passo|lei|politica|governanca|climatica|onibus|marketing|empresa de mudancas oferece|oferecemos|nossos servicos|indenizacao|avaria|sofá rasgado|sofa rasgado|quebrou|danificou|reclama|recusa a pagar|indenizar)\b/;
function contactFromPosting(r){
 const txt=String(r.description||"")+" "+String(r.title||"");
 // Somente dados explicitamente oferecidos para contato comercial no anuncio.
 const email=txt.match(/(?:contato|email|e-mail|or[cç]amento)[^\n]{0,35}?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]||"";
 const phone=txt.match(/(?:whats(?:app)?|telefone|tel\.?|contato)[^0-9]{0,16}((?:\+?55\s*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]*\d{4})/i)?.[1]||"";
 return {email:esc(email),phone:esc(phone),contactNote:email||phone?"Contato divulgado no pedido público; confirme se foi disponibilizado para propostas.":"Contato não divulgado no resultado. Consulte a fonte para responder pelo canal autorizado."};
}
function isPublicRequest(item){const t=normalize(item.title+" "+(item.description||""));return leadRequest.test(t)&&leadTransport.test(t)&&!leadReject.test(t);}
async function scanPublicRequests(){
 const results=await Promise.allSettled(leadQueries.map(async q=>{
  const u="https://www.bing.com/search?format=rss&q="+encodeURIComponent(q);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
  try{const response=await fetch(u,{signal:ctrl.signal,headers:{"User-Agent":"Mozilla/5.0 (compatible; MudancasBrasilPublicRequests/1.0)"}});if(!response.ok)throw Error("HTTP "+response.status);
   const xml=await response.text();if(!xml.includes("<rss")&&!xml.includes("<item"))throw Error("Fonte RSS indisponível");
   return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,20).map(m=>({title:esc(tag(m[1],"title")),description:esc(tag(m[1],"description")),link:esc(tag(m[1],"link")),publishedAt:tag(m[1],"pubDate"),searchTerm:q})).filter(x=>validLink(x.link)&&isPublicRequest(x));
  }finally{clearTimeout(timer)}
 }));
 const x=await load();x.requests=x.requests.filter(isPublicRequest);const known=new Set(x.requests.map(v=>v.link));let added=0;
 for(const r of results.filter(v=>v.status==="fulfilled").flatMap(v=>v.value)){
  if(known.has(r.link))continue;known.add(r.link);x.requests.unshift({...r,id:randomBytes(10).toString("hex"),source:"pedido_publico",status:"novo",discoveredAt:new Date().toISOString(),name:"Não informado",...contactFromPosting(r),origin:"",destination:"",originUF:"",destinationUF:""});added++;
 }
 x.requests=x.requests.slice(0,1000);await save(x);
 return {added,checked:results.length,unavailable:results.filter(v=>v.status==="rejected").length};
}



const googleAlertsFeeds=String(process.env.GOOGLE_ALERTS_RSS_URLS||"").split(/[\s,;]+/).map(v=>v.trim()).filter(Boolean).filter(v=>{
 try{const u=new URL(v);return u.protocol==="https:"&&(u.hostname==="www.google.com"||u.hostname==="google.com")&&u.pathname.startsWith("/alerts/feeds/")}catch{return false}
}).slice(0,8);
let googleAlertsLastError="",googleAlertsLastRun=null;
async function scanGoogleAlerts(){
 if(!googleAlertsFeeds.length)return {added:0,configured:false};
 const results=await Promise.allSettled(googleAlertsFeeds.map(async feed=>{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
  try{
   const response=await fetch(feed,{signal:ctrl.signal,headers:{"Accept":"application/atom+xml, application/rss+xml, application/xml","User-Agent":"MudancasBrasilGoogleAlerts/1.0"}});
   if(!response.ok)throw Error("Google Alerts HTTP "+response.status);
   const xml=await response.text();
   if(xml.length>1500000||!/<(?:feed|rss)\b/i.test(xml))throw Error("Feed RSS/Atom inválido");
   const blocks=[...xml.matchAll(/<(?:entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/(?:entry|item)>/gi)].slice(0,100).map(m=>m[1]);
   return blocks.map(entry=>{
    const attrLink=entry.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1]||"";
    const title=tag(entry,"title"),description=tag(entry,"content")||tag(entry,"summary")||tag(entry,"description");
    const link=decode(attrLink||tag(entry,"link"));
    const publishedAt=tag(entry,"published")||tag(entry,"updated")||tag(entry,"pubDate");
    return {title:esc(title),description:esc(description),link:esc(link),publishedAt,searchTerm:"Google Alerts"};
   }).filter(x=>validLink(x.link)&&isPublicRequest(x)&&!!(contactFromPosting(x).phone||contactFromPosting(x).email));
  }finally{clearTimeout(timer)}
 }));
 const x=await load();const known=new Set(x.requests.map(v=>v.link));let added=0;
 for(const item of results.filter(v=>v.status==="fulfilled").flatMap(v=>v.value)){
  if(known.has(item.link))continue;
  known.add(item.link);
  x.requests.unshift({...item,id:randomBytes(10).toString("hex"),source:"google_alerts",status:"novo",discoveredAt:new Date().toISOString(),name:"Não informado",...contactFromPosting(item),origin:"",destination:"",originUF:"",destinationUF:""});
  added++;
 }
 x.requests=x.requests.slice(0,1000);await save(x);
 googleAlertsLastRun=new Date().toISOString();
 const errors=results.filter(v=>v.status==="rejected");
 googleAlertsLastError=errors.length?errors.length+" feed(s) Google Alerts indisponível(is)":"";
 return {added,configured:true,checked:googleAlertsFeeds.length,errors:errors.length};
}

const MUDAR_URL="https://mudarbr.com.br/movinglist";
let mudarLastRun=null,mudarLastError="";
function parseMudarPublic(html){
 const raw=String(html);
 const stripped=decode(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<\/(?:div|p|li|section|article|span|a|h[1-6])>/gi,"\n").replace(/<[^>]*>/g," "));
 const scripts=[...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join(" ").replace(/\\u002[fF]/g,"/").replace(/\\n/g,"\n").replace(/\\"/g,'"');
 const pattern=/([\p{L}][\p{L} .'-]{1,65}?)\s*\/\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/gu;
 const out=[],seen=new Set();
 for(const source of [stripped,scripts]){
  const text=source.replace(/[ \t]+/g," ").replace(/\n\s*\n+/g,"\n");
  const matches=[...text.matchAll(pattern)];
  for(let i=0;i+1<matches.length&&out.length<300;i++){
   const m=matches[i],n=matches[i+1];if(n.index-m.index>180)continue;
   const detail=text.slice(n.index+n[0].length,Math.min(matches[i+2]?.index??text.length,n.index+n[0].length+300));
   const date=detail.match(/\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i);
   const vol=detail.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*m(?:³|3)/i);if(!date&&!vol)continue;
   const city1=m[1].split(/\n/).at(-1).trim(),city2=n[1].split(/\n/).at(-1).trim();
   if(!city1||!city2||/compartilhar|interessadas|ajudante|embalagem|montagem|flexivel/i.test(city1+" "+city2))continue;
   if(vol&&Number(vol[1].replace(",","."))>300)continue;
   const origin=city1+"/"+m[2],destination=city2+"/"+n[2],day=date?.[0]||"",volume=vol?.[1].replace(",",".")||"";
   const key=normalize([origin,destination,day,volume].join("|"));if(seen.has(key))continue;seen.add(key);
   out.push({origin,destination,originUF:m[2],destinationUF:n[2],date:day,volume,services:["Compartilhada","Montagem","Embalagem","Ajudante"].filter(v=>new RegExp(v,"i").test(detail)),link:MUDAR_URL});
   i++;
  }
 }
 return out;
}
function summarizeBrowserFailure(error,executable){
 const raw=String(error?.message||error||"Erro desconhecido");
 const missing=[...raw.matchAll(/(?:lib[\w+.-]+\.so(?:\.\d+)*|error while loading shared libraries|Host system is missing dependencies|No usable sandbox|Illegal instruction|SIG(?:KILL|SEGV)|OOM|out of memory)/gi)].map(m=>m[0]);
 let ldd="";
 if(executable&&existsSync(executable)){
  try{const result=spawnSync("ldd",[executable],{encoding:"utf8",timeout:6000,maxBuffer:200000});ldd=(result.stdout||"").split("\n").filter(line=>line.includes("not found")).map(line=>line.trim()).slice(0,8).join("; ")}catch{}
 }
 if(ldd)return "Chromium instalado, mas faltam bibliotecas Linux: "+ldd+". Instale dependências do sistema no container.";
 if(missing.length)return "Chromium não iniciou. Diagnóstico: "+[...new Set(missing)].join(", ")+". "+raw.slice(-400);
 if(/Target page, context or browser has been closed|browserType\.launch/i.test(raw))return "Chromium encerrou na inicialização. Verifique bibliotecas Linux, memória/limites do container e sandbox. Detalhes: "+raw.slice(-600);
 return "Chromium não iniciou: "+raw.slice(-600);
}
async function renderMudarWithBrowser(){
 // Fallback limitado à página pública; não utiliza sessões ou conteúdo protegido.
 let chromium;
 if(!process.env.MUDAR_CHROMIUM_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH="0";
 try{({chromium}=await import("playwright-core"))}
 catch{throw Error("Dependência playwright-core não instalada.")}
 const browserDir=path.join(process.cwd(),"node_modules","playwright-core",".local-browsers");
 const headlessShells=existsSync(browserDir)?readdirSync(browserDir).filter(name=>name.startsWith("chromium_headless_shell-")).map(name=>path.join(browserDir,name,"chrome-headless-shell-linux64","chrome-headless-shell")).filter(existsSync):[];
 const candidates=[
  process.env.MUDAR_CHROMIUM_PATH,
  ...headlessShells,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  null
 ].filter((v,i,a)=>v===null||Boolean(v)&&existsSync(v)&&a.indexOf(v)===i);
 let errors=[];
 for(const candidate of candidates){
  let browser;
  try{
   const options={headless:true,timeout:12000,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--no-default-browser-check","--disable-extensions"]};
   if(candidate)options.executablePath=candidate;
   browser=await chromium.launch(options);
   const context=await browser.newContext({locale:"pt-BR",viewport:{width:1280,height:850}});
   const page=await context.newPage();
   await page.route("**/*",route=>["image","font","media"].includes(route.request().resourceType())?route.abort():route.continue());
   const response=await page.goto(MUDAR_URL,{waitUntil:"domcontentloaded",timeout:20000});
   if(!response||response.status()>=400)throw Error("Navegador recebeu HTTP "+(response?.status()??"desconhecido"));
   try{await page.waitForFunction(()=>/\b\d+(?:[.,]\d+)?\s*m³/i.test(document.body?.innerText||""),null,{timeout:12000})}catch{}
   const items=parseMudarPublic(await page.content());
   if(!items.length)throw Error("Navegador abriu a página, mas os cartões não foram encontrados no conteúdo público renderizado.");
   return items;
  }catch(e){
   errors.push(summarizeBrowserFailure(e,candidate||headlessShells[0]||chromium.executablePath()));
  }finally{if(browser)await browser.close().catch(()=>{})}
 }
 throw Error(errors.join(" | ").slice(0,1300));
}
async function scanMudar(){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),16000);
 try{
  const robots=await fetch("https://mudarbr.com.br/robots.txt",{signal:ctrl.signal,headers:{"User-Agent":"MudancasBrasilPublicMonitor/1.0"}});
  if(robots.status!==404){
   if(!robots.ok)throw Error("Não foi possível verificar as regras de acesso da plataforma");
   let allow=true,global=false;
   for(const raw of (await robots.text()).split(/\r?\n/)){
    const line=raw.split("#")[0].trim(),ua=line.match(/^User-agent:\s*(.+)/i);
    if(ua){global=ua[1].trim()==="*";continue}
    if(global){const d=line.match(/^Disallow:\s*(\S+)/i);if(d&&(d[1]==="/"||"/movinglist".startsWith(d[1])))allow=false}
   }
   if(!allow)throw Error("O site restringe consulta automatizada da lista");
  }
  const response=await fetch(MUDAR_URL,{signal:ctrl.signal,cache:"no-store",headers:{"User-Agent":"MudancasBrasilPublicMonitor/1.0","Accept":"text/html","Cache-Control":"no-cache"}});
  if(!response.ok)throw Error("Fonte indisponível HTTP "+response.status);
  const html=await response.text();if(html.length>3000000)throw Error("Resposta acima do limite");
  let incoming=parseMudarPublic(html);if(!incoming.length){try{incoming=await renderMudarWithBrowser()}catch(browserError){throw Error("HTML recebido sem pedidos (HTTP "+response.status+", "+Buffer.byteLength(html)+" bytes). "+browserError.message+". Instale Chromium na VPS ou solicite um feed/API pública autorizada à MUDAR.")}}
  const x=await load(),previous=new Map(x.mudar.map(v=>[v.key,v]));let added=0;const dedupe=new Set();const checkedAt=new Date().toISOString();
  x.mudar=incoming.filter(v=>{const key=normalize([v.origin,v.destination,v.date,v.volume].join("|"));if(dedupe.has(key))return false;dedupe.add(key);return true}).map(v=>{
    const key=normalize([v.origin,v.destination,v.date,v.volume].join("|")),old=previous.get(key);if(!old)added++;
    return {...v,key,id:old?.id||randomBytes(10).toString("hex"),status:old?.status||"novo",source:"mudar_publico",firstSeen:old?.firstSeen||checkedAt,lastSeenAt:checkedAt}
  });
  await save(x);mudarLastRun=new Date().toISOString();mudarLastError="";return {added,total:x.mudar.length};
 }catch(e){mudarLastError=String(e.message||e).slice(0,950);return {added:0,error:mudarLastError}}finally{clearTimeout(timer)}
}

async function load(){try{const x=JSON.parse(await readFile(storage,"utf8"));return {opportunities:Array.isArray(x.opportunities)?x.opportunities:[],inquiries:Array.isArray(x.inquiries)?x.inquiries:[],requests:Array.isArray(x.requests)?x.requests:[],mudar:Array.isArray(x.mudar)?x.mudar:[]}}catch(e){if(e.code==="ENOENT")return {opportunities:[],inquiries:[],requests:[],mudar:[]};throw e}}
async function save(x){await mkdir(dir,{recursive:true,mode:0o700});const temp=storage+"."+randomBytes(6).toString("hex");await writeFile(temp,JSON.stringify(x,null,2),{mode:0o600});await rename(temp,storage)}
const extractUF=value=>{const match=String(value||"").toUpperCase().match(/(?:^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?=$|[^A-Z])/);return match?match[1]:""};
const validLink=url=>{try{const u=new URL(url);return u.protocol==="https:"||u.protocol==="http:"}catch{return false}};
export async function saveInquiry(fields,protocol){const x=await load();if(x.inquiries.some(i=>i.protocol===protocol))return;
 x.inquiries.unshift({id:randomBytes(10).toString("hex"),protocol,receivedAt:new Date().toISOString(),name:esc(fields.nome),email:esc(fields.email),phone:esc(fields.telefone),origin:esc(fields.origem),destination:esc(fields.destino),originUF:extractUF(fields.origem),destinationUF:extractUF(fields.destino),date:esc(fields.data),boxes:esc(fields.quantidadeCaixas),status:"novo",source:"formulario_site",notes:"Solicitou orçamento e autorizou uso dos dados para resposta."});
 x.inquiries=x.inquiries.slice(0,3000);await save(x)
}
export async function getCapture(){const x=await load();return {inquiries:x.inquiries,requests:x.requests.filter(isPublicRequest),mudar:x.mudar,opportunities:[],status:{mudarLastRun,mudarLastError,googleAlertsConfigured:googleAlertsFeeds.length>0,googleAlertsLastRun,googleAlertsLastError,active,lastRun,lastError,nextRun,frequencyHours:6,source:"Pedidos públicos declarados por interessados (sem buscas privadas)",paid:false}}}
export async function setCaptureStatus(id,status){if(!["novo","em_analise","contatado","descartado"].includes(status))throw Error("Status inválido");const x=await load();const item=[...x.inquiries,...x.opportunities,...x.requests,...x.mudar].find(v=>v.id===id);if(!item)throw Error("Registro não encontrado");item.status=status;await save(x);return item}
async function fetchFeed(term){const url="https://news.google.com/rss/search?q="+encodeURIComponent(term)+"&hl=pt-BR&gl=BR&ceid=BR:pt-419";
 const c=new AbortController();const timeout=setTimeout(()=>c.abort(),15000);
 try{const r=await fetch(url,{signal:c.signal,headers:{"User-Agent":"MudancasBrasilOpportunityMonitor/1.0"}});if(!r.ok)throw Error("RSS HTTP "+r.status);const xml=await r.text();return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,25).map(m=>{const title=tag(m[1],"title"),link=tag(m[1],"link"),date=tag(m[1],"pubDate");return {title:esc(title),link:esc(link),publishedAt:date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():"",term,origin:"",destination:"",originUF:"",destinationUF:""}}).filter(x=>x.title&&validLink(x.link))}
 finally{clearTimeout(timeout)}
}
export async function scanPublic(){if(active)return {running:true};active=true;lastError="";try{const result=await scanPublicRequests();const googleAlerts=await scanGoogleAlerts().catch(e=>{googleAlertsLastError=String(e.message||e).slice(0,220);return {added:0,error:googleAlertsLastError}});const mudar=await scanMudar();lastRun=new Date().toISOString();if(result.unavailable===leadQueries.length)lastError="As fontes públicas de busca estão indisponíveis ou limitaram consultas.";return {ok:true,publicRequests:result,mudar,googleAlerts,added:result.added+mudar.added+googleAlerts.added,found:result.checked,partialErrors:result.unavailable}}catch(e){lastError=String(e.message||e).slice(0,400);throw e}finally{active=false;nextRun=new Date(Date.now()+interval).toISOString()}}
export function startCaptureRobot(){nextRun=new Date(Date.now()+20000).toISOString();setTimeout(()=>{scanPublic().catch(e=>console.error("Monitor oportunidades:",e.message));},20000).unref?.();setInterval(()=>scanPublic().catch(e=>console.error("Monitor oportunidades:",e.message)),interval).unref?.()}
