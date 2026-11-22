const {handler}=require("./_lib");
const {sendAll}=require("./_notify");
// Only accept photo URLs that point at our own member-photos bucket.
const PHOTO=(process.env.SUPABASE_URL||"https://takdaiqvaxancqrqwwhy.supabase.co")+"/storage/v1/object/public/member-photos/";
const WELCOME=process.env.WELCOME_MESSAGE||"Hello {name}, welcome to Dunamis Campus Fellowship, UNN! We meet Tuesday 5:30 PM (Celebration Service), Thursday 5:00 PM (Bible Study), Friday 5:00 PM (Friday Prayer, Lawn Tennis) and Saturday 3:00 PM (Evangelism, Lawn Tennis). God bless you.";
// Consent is per channel and only what the person actually ticked counts. Nothing is assumed.
const pref=b=>({whatsapp:b.pref_whatsapp===true,sms:b.pref_sms===true,email:b.pref_email===true});
module.exports=handler({table:"members",consent:["pref_whatsapp","pref_sms","pref_email"],fields:["full_name","email","phone","department","faculty","course","level","status","intro","interests","bio","date_of_birth","state_of_origin","local_government","skills_business","photo_url","hostel_address"],
 required:["full_name","email","phone","department","date_of_birth","state_of_origin","local_government"],
 row:(d,b)=>{const p=pref(b);return{...d,photo_url:d.photo_url&&String(d.photo_url).startsWith(PHOTO)?d.photo_url:null,date_of_birth:d.date_of_birth||null,
  reg_pref_whatsapp:p.whatsapp,reg_pref_sms:p.sms,reg_pref_email:p.email,consent_comms:p.whatsapp||p.sms||p.email,
  consent_public:b.consent_public===true,profile_approved:false}},
 // The welcome message is OFF until AUTO_WELCOME=on is set in Vercel. It only uses channels the person ticked.
 after:(d,b)=>{if(process.env.AUTO_WELCOME!=="on")return;const p=pref(b),channels=["email","sms","whatsapp"].filter(c=>p[c]);if(!channels.length)return;
  return sendAll({member:{full_name:d.full_name,email:d.email,phone:d.phone,consent:p},channels,subject:"Welcome to Dunamis Campus Fellowship",message:WELCOME,kind:"welcome"})},
 subject:d=>"New DCF UNN registration: "+d.full_name,ok:"Welcome! A leader will be in touch."});
