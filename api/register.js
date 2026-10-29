const {handler}=require("./_lib");
module.exports=handler({table:"members",fields:["full_name","email","phone","department","faculty","course","level","status","intro","interests","bio","date_of_birth","state_of_origin","local_government","skills_business"],
 required:["full_name","email","phone","department","date_of_birth","state_of_origin","local_government"],consent:["consent_comms"],
 row:(d,b)=>({...d,date_of_birth:d.date_of_birth||null,consent_comms:true,consent_public:b.consent_public===true,profile_approved:false}),
 subject:d=>"New DCF UNN registration: "+d.full_name,ok:"Welcome! A leader will be in touch."});
 
