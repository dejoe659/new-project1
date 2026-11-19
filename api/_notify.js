// Sends one message by email, SMS (Termii) and/or WhatsApp (Meta Cloud API).
// A channel that is not configured is skipped, so you can switch them on one at a time.
const nodemailer=require("nodemailer");
const E=process.env;
const SB=E.SUPABASE_URL||"https://takdaiqvaxancqrqwwhy.supabase.co";
const SRV=E.SUPABASE_SERVICE_ROLE_KEY; // server-only secret. Never put it in the repo or in browser code.

const srv=async(path,opt={})=>{if(!SRV)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
 const r=await fetch(`${SB}/rest/v1/${path}`,{...opt,headers:{apikey:SRV,Authorization:`Bearer ${SRV}`,"Content-Type":"application/json",Prefer:"return=minimal",...opt.headers}});
 if(!r.ok)throw new Error("db "+r.status);return opt.method==="POST"||r.status===204?null:r.json()};

const firstName=n=>String(n||"").trim().split(/\s+/)[0]||"friend";
const fill=(t,m)=>String(t).replace(/\{name\}/gi,firstName(m.full_name));
const oneLine=t=>String(t).replace(/\s+/g," ").trim();
const intl=p=>{const d=String(p||"").replace(/\D/g,"");if(d.startsWith("234"))return d;if(d.startsWith("0")&&d.length===11)return"234"+d.slice(1);if(d.length===10)return"234"+d;return d};

let mailer;
const sendEmail=async(m,subject,text)=>{
 if(!E.GMAIL_USER||!E.GMAIL_APP_PASSWORD)return{skipped:"email not configured"};if(!m.email)return{skipped:"no email"};
 mailer=mailer||nodemailer.createTransport({service:"gmail",auth:{user:E.GMAIL_USER,pass:E.GMAIL_APP_PASSWORD}});
 await mailer.sendMail({from:`"Dunamis Campus Fellowship" <${E.GMAIL_USER}>`,to:m.email,subject,text});return{ok:true}};

const sendSms=async(m,text)=>{
 if(!E.TERMII_API_KEY||!E.TERMII_SENDER_ID)return{skipped:"sms not configured"};if(!m.phone)return{skipped:"no phone"};
 const r=await fetch("https://api.ng.termii.com/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({to:intl(m.phone),from:E.TERMII_SENDER_ID,sms:oneLine(text),type:"plain",channel:E.TERMII_CHANNEL||"generic",api_key:E.TERMII_API_KEY})});
 const j=await r.json().catch(()=>({}));if(!r.ok||!(j.message_id||/success/i.test(j.message||"")))throw new Error(j.message||"termii "+r.status);return{ok:true}};

// WhatsApp only lets a business start a chat with an approved template. The template has ONE variable, {{1}}, which receives the whole message.
const sendWhatsApp=async(m,text)=>{
 if(!E.WHATSAPP_TOKEN||!E.WHATSAPP_PHONE_ID||!E.WHATSAPP_TEMPLATE)return{skipped:"whatsapp not configured"};if(!m.phone)return{skipped:"no phone"};
 const r=await fetch(`https://graph.facebook.com/${E.WHATSAPP_GRAPH_VERSION||"v25.0"}/${E.WHATSAPP_PHONE_ID}/messages`,{method:"POST",headers:{Authorization:"Bearer "+E.WHATSAPP_TOKEN,"Content-Type":"application/json"},
  body:JSON.stringify({messaging_product:"whatsapp",to:intl(m.phone),type:"template",template:{name:E.WHATSAPP_TEMPLATE,language:{code:E.WHATSAPP_LANG||"en"},components:[{type:"body",parameters:[{type:"text",text:oneLine(text).slice(0,900)}]}]}})});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error((j.error&&j.error.message)||"whatsapp "+r.status);return{ok:true}};

// Who may be messaged, and on which channel. Fails closed: if consent cannot be checked, nothing is sent.
//  - member.consent  : explicit consent just given on the join form ({email,sms,whatsapp} booleans)
//  - member.id       : read the member's saved per-channel consent and global opt-out
//  - member.attendance_id : a visitor, who agreed to SMS / WhatsApp on the check-in page
const consentFor=async m=>{
 if(m.consent)return{map:m.consent};
 if(m.id){if(!SRV)return{deny:"consent check unavailable"};
  const r=await srv(`member_preferences?member_id=eq.${m.id}&select=whatsapp_opt_in,sms_opt_in,email_opt_in,opted_out&limit=1`);
  if(!r.length)return{deny:"no consent record"};const p=r[0];if(p.opted_out)return{deny:"member opted out"};
  return{map:{whatsapp:p.whatsapp_opt_in,sms:p.sms_opt_in,email:p.email_opt_in}}}
 if(m.attendance_id)return{map:{sms:true,whatsapp:true,email:false}};
 return{deny:"no consent record"}};
const addrOf=(ch,m)=>ch==="email"?String(m.email||"").trim().toLowerCase():intl(m.phone);
const suppressed=async(ch,a)=>{if(!SRV||!a)return false;
 return (await srv(`contact_suppressions?address=eq.${encodeURIComponent(a)}&channel=in.(${ch},all)&select=id&limit=1`)).length>0};

// member: {id?, full_name, email, phone}. Returns {email:"sent|failed|skipped", sms:..., whatsapp:...}. Never throws.
const sendAll=async({member,channels,subject,message,kind})=>{
 const text=fill(message,member),out={};
 let c;try{c=await consentFor(member)}catch(e){console.error("consent lookup failed:",e.message);c={deny:"consent check failed"}}
 await Promise.all(channels.map(async ch=>{let st="sent",detail=null;
  try{let why=c.deny||(c.map&&c.map[ch]?null:"no consent for "+ch);
   if(!why){try{if(await suppressed(ch,addrOf(ch,member)))why="contact opted out"}catch(e){why="opt-out check failed"}}
   const r=why?{skipped:why}:ch==="email"?await sendEmail(member,subject||"A message from DCF UNN",text):ch==="sms"?await sendSms(member,text):ch==="whatsapp"?await sendWhatsApp(member,text):{skipped:"unknown channel"};
   if(r.skipped){st="skipped";detail=r.skipped}}catch(e){st="failed";detail=String(e.message).slice(0,300);console.error(ch,"failed:",detail)}
  out[ch]=st;
  if(st!=="skipped"&&SRV)try{await srv("message_log",{method:"POST",body:JSON.stringify({member_id:member.id||null,attendance_id:member.attendance_id||null,recipient_name:member.full_name||null,recipient:ch==="email"?member.email:member.phone,channel:ch,kind,status:st,detail})})}catch(e){console.error("log failed",e.message)}}));
 return out};
module.exports={srv,sendAll,SB};
