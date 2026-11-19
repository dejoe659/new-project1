// Runs on a schedule (see vercel.json). Messages members who missed the last two sessions.
// OFF by default: set AUTO_FOLLOWUP=on in Vercel to enable it.
const {srv,sendAll}=require("./_notify");
const MSG=process.env.AUTO_MESSAGE||"Hello {name}, we missed you at Dunamis Campus Fellowship. We pray all is well with you and would love to see you at our next service. God bless you.";
module.exports=async(req,res)=>{
 if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({error:"Unauthorized"});
 if(process.env.AUTO_FOLLOWUP!=="on")return res.status(200).json({message:"Automatic follow-up is switched off."});
 try{
  const s=await srv("sessions?select=id,session_date&order=session_date.desc&limit=2");
  if(s.length<2)return res.status(200).json({message:"Needs at least two sessions."});
  if((Date.now()-new Date(s[0].session_date))/864e5>8)return res.status(200).json({message:"Latest session is more than a week old. Nothing sent."});
  const att=await srv(`attendance?session_id=in.(${s.map(x=>x.id).join(",")})&member_id=not.is.null&select=member_id`),seen=new Set(att.map(x=>x.member_id));
  const since=encodeURIComponent(new Date(Date.now()-6*864e5).toISOString());
  const done=new Set((await srv(`message_log?kind=eq.missed_two&created_at=gte.${since}&select=member_id`)).map(x=>x.member_id));
  const todo=(await srv("members?review_status=neq.rejected&consent_comms=eq.true&select=id,full_name,email,phone,created_at"))
   .filter(m=>!seen.has(m.id)&&!done.has(m.id)&&m.created_at.slice(0,10)<=s[1].session_date);
  const channels=(process.env.AUTO_CHANNELS||"sms,whatsapp,email").split(",").map(x=>x.trim());
  for(let i=0;i<todo.length;i+=5)await Promise.all(todo.slice(i,i+5).map(m=>sendAll({member:m,channels,subject:"We missed you",message:MSG,kind:"missed_two"})));
  res.status(200).json({messaged:todo.length});
 }catch(e){console.error(e);res.status(500).json({error:"Server error."})}};
