// Called by the check-in page right after a VISITOR checks in. OFF until AUTO_VISITOR_THANKS=on.
// The caller only supplies the service code and phone. The recipient is read from the database,
// the text is fixed, a visit is only thanked once, and only for check-ins from the last 30 minutes.
const {srv,sendAll}=require("./_notify");
const visitors=require("./_comms/visitors"),queue=require("./_comms/queue");
const MSG=process.env.VISITOR_THANKS_MESSAGE||"Hello {name}, thank you for worshipping with us at Dunamis Campus Fellowship. We were glad to have you and would love to see you again. God bless you.";
const none=(res,why)=>res.status(200).json({message:why});
module.exports=async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
 const code=String((req.body||{}).code||"").replace(/\D/g,""),phone=String((req.body||{}).phone||"").trim();
 if(code.length<4||code.length>8||phone.length<7||phone.length>20)return none(res,"ignored");
 try{
  const s=await srv(`sessions?code=eq.${code}&is_open=eq.true&select=id&limit=1`);if(!s.length)return none(res,"ignored");
  const a=await srv(`attendance?session_id=eq.${s[0].id}&visitor_phone=eq.${encodeURIComponent(phone)}&visitor_name=not.is.null&order=created_at.desc&limit=1&select=id,visitor_name,visitor_phone,created_at`);
  if(!a.length||Date.now()-new Date(a[0].created_at)>30*60*1000)return none(res,"ignored");
  // Welcome EMAIL (own switch: the visitor_followup rule). The email address is read from the database, never from the caller.
  try{const w=await visitors.welcome({attendanceId:a[0].id});if(w.queued)await queue.runBatch({limit:5,workerId:"checkin"})}catch(e){console.error("visitor welcome failed:",e.message)}
  if(process.env.AUTO_VISITOR_THANKS!=="on")return none(res,"email only");
  if((await srv(`message_log?attendance_id=eq.${a[0].id}&kind=eq.visitor_thanks&select=id&limit=1`)).length)return none(res,"already sent");
  const hour=encodeURIComponent(new Date(Date.now()-3600e3).toISOString());
  if((await srv(`message_log?kind=eq.visitor_thanks&created_at=gte.${hour}&select=id&limit=200`)).length>=60)return none(res,"hourly limit reached"); // protects your SMS credit
  const channels=(process.env.AUTO_VISITOR_CHANNELS||"sms,whatsapp").split(",").map(x=>x.trim()).filter(c=>c!=="email"); // visitors have no email
  await sendAll({member:{attendance_id:a[0].id,full_name:a[0].visitor_name,phone:a[0].visitor_phone,email:null},channels,message:MSG,kind:"visitor_thanks"});
  res.status(200).json({message:"sent"});
 }catch(e){console.error(e);res.status(200).json({message:"error"})} // never show check-in errors to a visitor
};
