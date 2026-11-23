// Public prayer and counselling form, and status check by code.
(()=>{
const f=$("#care"),cm=$("#cm"),say=(el,t,ok)=>{el.textContent=t;el.className="msg "+(ok?"ok":"err")};
const post=async b=>{const r=await fetch("/api/comms/care",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Something went wrong.");return j};
const sync=()=>{const kind=f.elements.kind.value,anon=f.elements.anonymous.checked;$("#who").hidden=anon;$("#pr").hidden=kind==="counselling"};
f.addEventListener("change",sync);sync();
f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector("button.btn"),v=Object.fromEntries(new FormData(f));
 if(!String(v.message||"").trim()||v.message.trim().length<5)return say(cm,"Please tell us a little more about your request.");
 b.disabled=true;say(cm,"");
 try{const j=await post({action:"submit",kind:v.kind,category:v.category,message:v.message,anonymous:!!v.anonymous,name:v.name,phone:v.phone,email:v.email,privacy:v.privacy,website:v.website});
  if(!j.code){say(cm,j.message,true);return}
  f.hidden=true;$("#done").hidden=false;$("#code").textContent=j.code;f.reset();window.scrollTo({top:0})}
 catch(x){say(cm,x.message)}finally{b.disabled=false}};
$("#st").onsubmit=async e=>{e.preventDefault();const sm=$("#sm");say(sm,"");
 try{const j=await post({action:"status",code:$("#stc").value});say(sm,(j.kind==="counselling"?"Counselling request":"Prayer request")+" received "+new Date(j.received).toLocaleDateString("en-GB")+". Status: "+j.status+".",true)}
 catch(x){say(sm,x.message)}};
})();
