const {handler}=require("./_lib");
module.exports=handler({fields:["name","email","message"],required:["name","email","message"],subject:d=>"DCF UNN website message from "+d.name,ok:"Message sent. We will reply by email."});
