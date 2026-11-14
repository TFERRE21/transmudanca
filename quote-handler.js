import Busboy from "busboy";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

const CONTACT_EMAIL = process.env.QUOTE_TO_EMAIL || "mudancasbrasiltransporte@gmail.com";
const MAX_UPLOAD = 3 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;
const FIELDS = ["nome","email","telefone","resposta","origem","destino","enderecoOrigem","enderecoDestino","data","tipo","moveis","quantidadeCaixas","observacoes","consentimento"];
const LABELS = {nome:"Nome",email:"E-mail",telefone:"WhatsApp",resposta:"Resposta preferida",origem:"Origem",destino:"Destino",enderecoOrigem:"Detalhes da origem",enderecoDestino:"Detalhes do destino",data:"Data prevista",tipo:"Tipo de mudança",moveis:"Lista de móveis e materiais",quantidadeCaixas:"Quantidade de caixas",observacoes:"Observações"};
const clean = value => String(value || "").replace(/[\x00-\x1f\x7f]/g," ").trim();
const htmlEscape = value => clean(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const pdfText = value => clean(value).replace(/[^\x20-\x7e\u00c0-\u00ff\u0100-\u017f]/g,"?");

function parseRequest(req){
 return new Promise((resolve,reject)=>{
  const fields={},photos=[];
  let total=0,failed=false;
  const fail=e=>{if(!failed){failed=true;reject(e)}};
  const bb=Busboy({headers:req.headers,limits:{files:50,fileSize:MAX_UPLOAD,fields:20,fieldSize:15000,parts:75}});
  bb.on("field",(name,value)=>{if(FIELDS.includes(name))fields[name]=value});
  bb.on("file",(name,stream,info)=>{
   if(name!=="fotos"){stream.resume();return}
   const chunks=[];let length=0;
   if(!["image/jpeg","image/png"].includes(info.mimeType)){fail(new Error("Use apenas fotos JPG ou PNG."));stream.resume();return}
   stream.on("limit",()=>fail(new Error("Uma foto excede 3 MB.")));
   stream.on("data",chunk=>{length+=chunk.length;total+=chunk.length;if(total>MAX_TOTAL)fail(new Error("Arquivos muito grandes."));else chunks.push(chunk)});
   stream.on("end",()=>{if(!failed)photos.push({name:clean(info.filename).slice(0,100),type:info.mimeType,buffer:Buffer.concat(chunks)})});
  });
  bb.on("filesLimit",()=>fail(new Error("Máximo de 50 fotos.")));
  bb.on("partsLimit",()=>fail(new Error("Muitos campos enviados.")));
  bb.on("error",fail);
  bb.on("close",()=>{if(!failed)resolve({fields,photos})});
  req.pipe(bb);
 });
}
function makePDF(fields,photos,protocol){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:"A4",margin:48,bufferPages:true});
  const chunks=[];
  doc.on("data",chunk=>chunks.push(chunk));
  doc.on("end",()=>resolve(Buffer.concat(chunks)));
  doc.on("error",reject);
  doc.fillColor("#075b32").fontSize(21).text("Mudanças Brasil");
  doc.fillColor("#20352a").fontSize(15).text("Solicitação de orçamento online");
  doc.moveDown(.5).fontSize(9).text("Protocolo: "+protocol+" | Recebido em: "+new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}));
  doc.moveDown();
  for(const [key,label] of Object.entries(LABELS)){
   const value=pdfText(fields[key]||"Não informado");
   doc.font("Helvetica-Bold").fontSize(10).fillColor("#075b32").text(label+":");
   doc.font("Helvetica").fillColor("#222222").text(value,{width:490});
   doc.moveDown(.5);
  }
  if(photos.length){doc.addPage();doc.font("Helvetica-Bold").fontSize(16).fillColor("#075b32").text("Fotos dos móveis");doc.moveDown();
   for(let i=0;i<photos.length;i++){
    const photo=photos[i];
    if(doc.y>560)doc.addPage();
    doc.font("Helvetica").fontSize(10).fillColor("#222222").text("Foto "+(i+1)+" — "+pdfText(photo.name));
    try{doc.image(photo.buffer,48,doc.y+8,{fit:[490,210],align:"center"});doc.y+=232;doc.moveDown(.5)}catch{doc.text("Não foi possível incorporar esta imagem.")}
   }
  }
  doc.end();
 });
}
export async function handleQuote(req,res){
 const reply=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data))};
 if(!process.env.RESEND_API_KEY||!process.env.QUOTE_FROM_EMAIL){reply(503,{ok:false,error:"O envio de orçamento por e-mail ainda não está configurado. Use o WhatsApp."});return}
 if(!req.headers["content-type"]?.startsWith("multipart/form-data")){reply(415,{ok:false,error:"Formato inválido."});return}
 try{
  const {fields,photos}=await parseRequest(req);
  if(!fields.nome?.trim()||!fields.email?.trim()||!fields.telefone?.trim()||!fields.origem?.trim()||!fields.destino?.trim()||!fields.moveis?.trim()||fields.consentimento!=="on")return reply(400,{ok:false,error:"Preencha os campos obrigatórios e autorize o tratamento dos dados."});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)||fields.email.length>200)return reply(400,{ok:false,error:"E-mail inválido."});
  if(!/^(0|[1-9][0-9]{0,4})$/.test(String(fields.quantidadeCaixas??""))||Number(fields.quantidadeCaixas)>10000)return reply(400,{ok:false,error:"Informe a quantidade de caixas (0 se não houver)."});
  if(fields.moveis.length>12000)return reply(400,{ok:false,error:"Lista de móveis muito extensa."});
  const protocol=randomUUID().slice(0,8).toUpperCase();
  const optimized=[];
  for(const photo of photos){
   try{const buffer=await sharp(photo.buffer,{limitInputPixels:25000000}).rotate().resize({width:1100,height:1100,fit:"inside",withoutEnlargement:true}).jpeg({quality:66,mozjpeg:true}).toBuffer();optimized.push({...photo,buffer,type:"image/jpeg"})}
   catch{return reply(400,{ok:false,error:"Uma das fotos não pôde ser processada. Envie apenas JPG ou PNG válidos."})}
  }
  const pdf=await makePDF(fields,optimized,protocol);
  if(pdf.length>25*1024*1024)return reply(413,{ok:false,error:"O PDF ficou muito grande. Reduza a quantidade de fotos ou envie em partes."});
  const summary=Object.entries(LABELS).map(([key,label])=>"<p><strong>"+label+":</strong> "+htmlEscape(fields[key]||"Não informado")+"</p>").join("");
  const result=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.QUOTE_FROM_EMAIL,to:[CONTACT_EMAIL],reply_to:fields.email,subject:"Novo orçamento Mudanças Brasil — "+protocol,html:"<h2>Solicitação de orçamento online</h2><p>Protocolo: "+protocol+"</p>"+summary+"<p>Fotos recebidas: "+photos.length+". O PDF completo está anexo.</p>",attachments:[{filename:"orcamento-mudancas-"+protocol+".pdf",content:pdf.toString("base64")}]})});
  if(!result.ok){console.error("Falha Resend orçamento",result.status,(await result.text()).slice(0,500));return reply(502,{ok:false,error:"Não foi possível enviar o e-mail. Tente pelo WhatsApp."})}
  reply(200,{ok:true,protocolo:protocol});
 }catch(e){console.error("Erro no orçamento:",e.message);reply(400,{ok:false,error:"Não foi possível processar os dados ou as fotos. Verifique os arquivos."})}
}
