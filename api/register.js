const {handler}=require("./_lib");
const {sendAll}=require("./_notify");
// Only accept photo URLs that point at our own member-photos bucket.
const PHOTO=(process.env.SUPABASE_URL||"https://takdaiqvaxancqrqwwhy.supabase.co")+"/storage/v1/object/public/member-photos/";
const WELCOME=process.env.WELCOME_MESSAGE||"Hello {name}, welcome to Dunamis Campus Fellowship, UNN! We meet Tuesday 5:30 PM (Celebration Service), Thursday 5:00 PM (Bible Study), Friday 5:00 PM (Friday Prayer, Lawn Tennis) and Saturday 3:00 PM (Evangelism, Lawn Tennis). God bless you.";
module.exports=handler({table:"members",fields:["full_name","email","phone","department","faculty","course","level","status","intro","interests","bio","date_of_birth","state_of_origin","local_government","skills_business","photo_url"],
 required:["full_name","email","phone","department","date_of_birth","state_of_origin","local_government"],consent:["consent_comms"],
 row:(d,b)=>({...d,photo_url:d.photo_url&&String(d.photo_url).startsWith(PHOTO)?d.photo_url:null,date_of_birth:d.date_of_birth||null,consent_comms:true,consent_public:b.consent_public===true,profile_approved:false}),
 // They ticked the communications consent box (required above), so a welcome message is allowed.
 after:d=>sendAll({member:{full_name:d.full_name,email:d.email,phone:d.phone},channels:["email","sms","whatsapp"],subject:"Welcome to Dunamis Campus Fellowship",message:WELCOME,kind:"welcome"}),
 subject:d=>"New DCF UNN registration: "+d.full_name,ok:"Welcome! A leader will be in touch."});
