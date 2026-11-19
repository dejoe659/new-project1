// Admin-only. The Follow-up tab calls this with the signed-in admin's token.
const {srv,sendAll,SB}=require("./_notify");
const {K:ANON}=require("./_lib");
const CH=["email","sms","whatsapp"],UUID=/^[0-9a-f-]{36}$/i;
module.exports=async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
 const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!token)return res.status(401).json({error:"Please sign in again."});
 try{
  const h={apikey:ANON,Authorization:"Bearer "+token};
  const u=await fetch(`${SB}/auth/v1/user`,{headers:h});if(!u.ok)return res.status(401).json({error:"Session expired. Sign in again."});
  const a=await fetch(`${SB}/rest/v1/admins?select=role`,{headers:h}),rows=a.ok?await a.json():[];if(!rows.length)return res.status(403).json({error:"Administrators only."});
  const b=req.body||{},pick=k=>Array.isArray(b[k])?b[k].filter(i=>UUID.test(i)):[],ids=pick("member_ids"),vids=pick("visitor_ids");
  const channels=(Array.isArray(b.channels)?b.channels:[]).filter(c=>CH.includes(c)),message=String(b.message||"").trim().slice(0,600);
  if(!(ids.length+vids.length)||!channels.length||!message)return res.status(400).json({error:"Choose people, a channel and write a message."});
  if(ids.length+vids.length>50)return res.status(400).json({error:"Send to at most 50 people at a time."});
  // Members must have agreed to communications. Visitors are reached by phone only (SMS / WhatsApp), and only when a leader sends it from this tab.
  const members=ids.length?await srv(`members?id=in.(${ids.join(",")})&consent_comms=eq.true&select=id,full_name,email,phone`):[];
  const visitors=vids.length?(await srv(`attendance?id=in.(${vids.join(",")})&visitor_name=not.is.null&select=id,visitor_name,visitor_phone`)).filter(v=>v.visitor_phone).map(v=>({attendance_id:v.id,full_name:v.visitor_name,phone:v.visitor_phone,email:null})):[];
  const tot=Object.fromEntries(channels.map(c=>[c,{sent:0,failed:0,skipped:0}]));
  const jobs=[...members.map(m=>({m,kind:"manual"})),...visitors.map(m=>({m,kind:"manual_visitor"}))];
  for(let i=0;i<jobs.length;i+=5)await Promise.all(jobs.slice(i,i+5).map(async({m,kind})=>{const r=await sendAll({member:m,channels,subject:"A message from Dunamis Campus Fellowship",message,kind});for(const c of channels)tot[c][r[c]||"failed"]++}));
  const name={email:"Email",sms:"SMS",whatsapp:"WhatsApp"};
  const parts=channels.map(c=>`${name[c]}: ${tot[c].sent} sent`+(tot[c].failed?`, ${tot[c].failed} failed`:"")+(tot[c].skipped?`, ${tot[c].skipped} skipped`:""));
  const noConsent=ids.length-members.length,noPhone=vids.length-visitors.length;
  res.status(200).json({summary:parts.join(" · ")+(noConsent?` · ${noConsent} member(s) not messaged (no consent to communications).`:"")+(noPhone?` · ${noPhone} visitor(s) not messaged (no phone number).`:"")+(channels.some(c=>tot[c].failed)?" Check the message_log table for the reason.":"")});
 }catch(e){console.error(e);res.status(500).json({error:"Server error. Check the Vercel function logs."})}};
