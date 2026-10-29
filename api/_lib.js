const nodemailer=require("nodemailer");
const U=process.env.SUPABASE_URL||"https://takdaiqvaxancqrqwwhy.supabase.co";
// Public anon key: safe by design. Row Level Security and column grants limit what it can do.
const K=process.env.SUPABASE_ANON_KEY||"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRha2RhaXF2YXhhbmNxcnF3d2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDkyNDUsImV4cCI6MjEwODc4NTI0NX0.cMNEb_tr1gRtVRwJa5kQqvqctyR9UjdroJ34umG4L8Q";
const {GMAIL_USER,GMAIL_APP_PASSWORD}=process.env;
const db=async(path,opt={})=>{const r=await fetch(`${U}/rest/v1/${path}`,{...opt,headers:{apikey:K,Authorization:`Bearer ${K}`,"Content-Type":"application/json",Prefer:"return=minimal",...opt.headers}});
 if(!r.ok)throw new Error("db "+r.status);return r.status===204||opt.method==="POST"?null:r.json()};
const mail=async(subject,text)=>{if(!GMAIL_USER||!GMAIL_APP_PASSWORD){console.warn("Email not configured");return}try{await nodemailer.createTransport({service:"gmail",auth:{user:GMAIL_USER,pass:GMAIL_APP_PASSWORD}}).sendMail({from:GMAIL_USER,to:GMAIL_USER,subject,text})}catch(e){console.error("mail failed",e.message)}};
const emailOk=e=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e||"");
const clean=(o,keys,max=2000)=>Object.fromEntries(keys.map(k=>[k,typeof o[k]==="string"?o[k].trim().slice(0,max):o[k]]));
// Shared handler: validate, store (if table), email the fellowship.
const handler=(cfg)=>async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
 const b=req.body||{};if(b.website)return res.status(200).json({message:"Thank you."}); // honeypot
 try{const d=clean(b,cfg.fields);
  for(const k of cfg.required)if(!d[k])return res.status(400).json({error:"Missing "+k+"."});
  if(d.email&&!emailOk(d.email))return res.status(400).json({error:"Invalid email address."});
  for(const k of cfg.consent||[])if(b[k]!==true)return res.status(400).json({error:"Consent is required."});
  if(cfg.table)await db(cfg.table,{method:"POST",body:JSON.stringify(cfg.row?cfg.row(d,b):d)});
  await mail(cfg.subject(d),Object.entries(d).map(([k,v])=>k+": "+v).join("\n"));
  res.status(200).json({message:cfg.ok});
 }catch(e){console.error(e);res.status(500).json({error:"Server error."})}};
module.exports={db,handler};
