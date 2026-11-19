import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";

const dir=process.env.ADMIN_DATA_DIR||"/data/mudancas-brasil";
const storage=path.join(dir,"captacao.json");
const terms=["pedido transporte de mudança Brasília DF","contratação serviço de mudança transporte mobiliário Distrito Federal","empresa precisa transporte mudança Goiás","licitação transporte mudança mobiliário"];
const interval=6*60*60*1000;
let active=false, lastError="",lastRun=null, nextRun=null;
const esc=s=>String(s??"").trim().slice(0,700);
const decode=s=>String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const tag=(s,t)=>decode(s.match(new RegExp("<"+t+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+t+">","i"))?.[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
async function load(){try{const x=JSON.parse(await readFile(storage,"utf8"));return {opportunities:Array.isArray(x.opportunities)?x.opportunities:[],inquiries:Array.isArray(x.inquiries)?x.inquiries:[]}}catch(e){if(e.code==="ENOENT")return {opportunities:[],inquiries:[]};throw e}}
async function save(x){await mkdir(dir,{recursive:true,mode:0o700});const temp=storage+"."+randomBytes(6).toString("hex");await writeFile(temp,JSON.stringify(x,null,2),{mode:0o600});await rename(temp,storage)}
const extractUF=value=>{const match=String(value||"").toUpperCase().match(/(?:^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?=$|[^A-Z])/);return match?match[1]:""};
const validLink=url=>{try{const u=new URL(url);return u.protocol==="https:"||u.protocol==="http:"}catch{return false}};
export async function saveInquiry(fields,protocol){const x=await load();if(x.inquiries.some(i=>i.protocol===protocol))return;
 x.inquiries.unshift({id:randomBytes(10).toString("hex"),protocol,receivedAt:new Date().toISOString(),name:esc(fields.nome),email:esc(fields.email),phone:esc(fields.telefone),origin:esc(fields.origem),destination:esc(fields.destino),originUF:extractUF(fields.origem),destinationUF:extractUF(fields.destino),date:esc(fields.data),boxes:esc(fields.quantidadeCaixas),status:"novo",source:"formulario_site",notes:"Solicitou orçamento e autorizou uso dos dados para resposta."});
 x.inquiries=x.inquiries.slice(0,3000);await save(x)
}
export async function getCapture(){const x=await load();return {...x,status:{active,lastRun,lastError,nextRun,frequencyHours:6,source:"Google Notícias RSS — páginas públicas",paid:false}}}
export async function setCaptureStatus(id,status){if(!["novo","em_analise","contatado","descartado"].includes(status))throw Error("Status inválido");const x=await load();const item=[...x.inquiries,...x.opportunities].find(v=>v.id===id);if(!item)throw Error("Registro não encontrado");item.status=status;await save(x);return item}
async function fetchFeed(term){const url="https://news.google.com/rss/search?q="+encodeURIComponent(term)+"&hl=pt-BR&gl=BR&ceid=BR:pt-419";
 const c=new AbortController();const timeout=setTimeout(()=>c.abort(),15000);
 try{const r=await fetch(url,{signal:c.signal,headers:{"User-Agent":"MudancasBrasilOpportunityMonitor/1.0"}});if(!r.ok)throw Error("RSS HTTP "+r.status);const xml=await r.text();return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,25).map(m=>{const title=tag(m[1],"title"),link=tag(m[1],"link"),date=tag(m[1],"pubDate");return {title:esc(title),link:esc(link),publishedAt:date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():"",term,origin:"",destination:"",originUF:"",destinationUF:""}}).filter(x=>x.title&&validLink(x.link))}
 finally{clearTimeout(timeout)}
}
export async function scanPublic(){if(active)return {running:true};active=true;lastError="";let count=0;
 try{const batches=await Promise.allSettled(terms.map(fetchFeed));const all=batches.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);const errors=batches.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));if(!all.length&&errors.length)throw Error(errors.join("; ").slice(0,400));
 const x=await load();const seen=new Set(x.opportunities.map(i=>i.link));for(const o of all){if(seen.has(o.link))continue;seen.add(o.link);x.opportunities.unshift({...o,id:randomBytes(10).toString("hex"),source:"noticia_publica",discoveredAt:new Date().toISOString(),status:"novo"});count++}
 x.opportunities=x.opportunities.slice(0,1000);await save(x);lastRun=new Date().toISOString();lastError=errors.join("; ").slice(0,400);return {ok:true,added:count,found:all.length,partialErrors:errors.length}
 }catch(e){lastError=String(e.message||e).slice(0,400);throw e}finally{active=false;nextRun=new Date(Date.now()+interval).toISOString()}
}
export function startCaptureRobot(){nextRun=new Date(Date.now()+20000).toISOString();setTimeout(()=>{scanPublic().catch(e=>console.error("Monitor oportunidades:",e.message));},20000).unref?.();setInterval(()=>scanPublic().catch(e=>console.error("Monitor oportunidades:",e.message)),interval).unref?.()}
