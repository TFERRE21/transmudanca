import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
const dir=process.env.ADMIN_DATA_DIR||"/data/mudancas-brasil";
const file=path.join(dir,"clientes.json");
const secret=process.env.ADMIN_SESSION_SECRET||"";
const username=process.env.ADMIN_USERNAME||"";
const password=process.env.ADMIN_PASSWORD||"";
const sessions=new Map();
const send=(res,status,obj,headers={})=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers});res.end(JSON.stringify(obj));};
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>150000)throw Error("Limite excedido");chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}")}
const cookie=req=>(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("mb_session="))?.slice(11);
const safeEqual=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb)};
function auth(req){const token=cookie(req);if(!token)return false;const [id,sig]=token.split(".");if(!id||!sig||!secret)return false;const expected=createHmac("sha256",secret).update(id).digest("hex");return safeEqual(sig,expected)&&sessions.has(id)&&sessions.get(id)>Date.now()}
async function load(){try{const data=JSON.parse(await readFile(file,"utf8"));return Array.isArray(data)?data:[]}catch(e){if(e.code==="ENOENT")return [];throw e}}
async function save(data){await mkdir(dir,{recursive:true,mode:0o700});const tmp=file+"."+randomBytes(6).toString("hex");await writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await rename(tmp,file)}
const clean=(v,max=400)=>String(v??"").trim().slice(0,max);
function validOrigin(req){const origin=req.headers.origin;if(!origin)return false;try{return new URL(origin).host===req.headers.host&&new URL(origin).protocol==="https:" || (process.env.NODE_ENV!=="production"&&new URL(origin).host===req.headers.host)}catch{return false}}
export async function handleAdmin(req,res,url){
 if(!username||!password||secret.length<32)return send(res,503,{error:"Configure ADMIN_USERNAME, ADMIN_PASSWORD e ADMIN_SESSION_SECRET (32+ caracteres)."});
 const post=req.method==="POST";if(post&&!validOrigin(req))return send(res,403,{error:"Origem inválida"});
 if(url.pathname==="/api/admin/login"&&post){let b;try{b=await body(req)}catch{return send(res,400,{error:"Dados inválidos"})}const a=scryptSync(clean(b.password,300),"mudancas-brasil-login",64);const z=scryptSync(password,"mudancas-brasil-login",64);if(!safeEqual(clean(b.username,100),username)||!timingSafeEqual(a,z))return send(res,401,{error:"Usuário ou senha inválidos"});const id=randomBytes(32).toString("hex");sessions.set(id,Date.now()+8*3600000);const sig=createHmac("sha256",secret).update(id).digest("hex");return send(res,200,{ok:true},{"Set-Cookie":`mb_session=${id}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=28800`})}
 if(!auth(req))return send(res,401,{error:"Acesso não autorizado"});
 if(url.pathname==="/api/admin/logout"&&post){const id=cookie(req)?.split(".")[0];sessions.delete(id);return send(res,200,{ok:true},{"Set-Cookie":"mb_session=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0"})}
 if(url.pathname==="/api/admin/me"&&req.method==="GET")return send(res,200,{ok:true,user:username});
 if(url.pathname==="/api/admin/clientes"&&req.method==="GET")return send(res,200,{clientes:await load()});
 if(url.pathname==="/api/admin/clientes"&&post){let b;try{b=await body(req)}catch{return send(res,400,{error:"Dados inválidos"})}
 const allowed=["previsto","fechado","concluido","cancelado"];if(!clean(b.nome,150)||!allowed.includes(b.status))return send(res,400,{error:"Nome e status obrigatórios"});
 const all=await load();const id=clean(b.id,80)||randomBytes(12).toString("hex");const record={id,nome:clean(b.nome,150),telefone:clean(b.telefone,40),origem:clean(b.origem,250),destino:clean(b.destino,250),data:clean(b.data,30),metragem:clean(b.metragem,20),valor:clean(b.valor,30),status:b.status,observacoes:clean(b.observacoes,2000),updatedAt:new Date().toISOString()};
 const index=all.findIndex(x=>x.id===id);if(index>=0)all[index]=record;else all.unshift(record);await save(all);return send(res,200,{cliente:record})}
 if(url.pathname==="/api/admin/excluir"&&post){let b;try{b=await body(req)}catch{return send(res,400,{error:"Dados inválidos"})}const all=await load();await save(all.filter(x=>x.id!==b.id));return send(res,200,{ok:true})}
 return send(res,404,{error:"Rota inexistente"});
}
