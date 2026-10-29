const {handler}=require("./_lib");
module.exports=handler({table:"testimonies",fields:["name","title","category","content","email"],required:["title","content"],consent:["consent_publish"],
 row:d=>({...d,status:"pending",consent_publish:true}),subject:d=>"New testimony to review: "+d.title,ok:"Thank you. A leader will review your testimony before it is published."});
