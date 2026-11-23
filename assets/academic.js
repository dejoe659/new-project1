// Academic help form: faculty -> department, send a private request, check status with a code.
(()=>{
const f=$("#acad");if(!f)return;
const post=async b=>{const r=await fetch("/api/comms/academic",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Something went wrong.");return j};
const say=(el,t,ok)=>{el.textContent=t;el.className="msg "+(ok?"ok":"err")};
let cat=[];
const draw=()=>{const l=$("#fl");if(!l)return;
 if(!cat.length){l.innerHTML='<p class="empty">We could not load the faculties just now. Please refresh the page.</p>';return}
 l.innerHTML=cat.map(x=>`<details><summary><strong>Faculty of ${esc(x.name)}</strong> <small>(${x.departments.length})</small></summary><div class="grid">${x.departments.map(d=>`<button type="button" class="btn sm ghost" data-f="${esc(x.id)}" data-d="${esc(d.id)}">${esc(d.name)}</button>`).join("")}</div></details>`).join("")};
document.addEventListener("click",e=>{const b=e.target.closest("button[data-d]");if(!b)return;$("#af").value=b.dataset.f;$("#af").dispatchEvent(new Event("change"));$("#ad").value=b.dataset.d;$("#help").scrollIntoView({behavior:"smooth"});f.elements.course.focus()});
(async()=>{try{cat=(await post({action:"faculties"})).faculties}catch{cat=[]}
 draw();
 $("#af").innerHTML='<option value="">Choose your faculty</option>'+cat.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")})();
$("#af").addEventListener("change",()=>{const x=cat.find(c=>c.id===$("#af").value);
 $("#ad").innerHTML=x?'<option value="">Choose your department</option>'+x.departments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")+'<option value="">Not listed</option>':'<option value="">Choose a faculty first</option>'});
f.addEventListener("submit",async e=>{e.preventDefault();const m=$("#am"),b=f.querySelector("button");b.disabled=true;
 try{const el=f.elements,r=await post({action:"submit",faculty_id:el.faculty_id.value,department_id:el.department_id.value,course:el.course.value,level:el.level.value,issue:el.issue.value,name:el.name.value,phone:el.phone.value,email:el.email.value,website:el.website.value});
  f.hidden=true;$("#adone").hidden=false;$("#amsg").textContent=r.message;$("#acode").textContent=r.code||""}
 catch(x){say(m,x.message,false)}finally{b.disabled=false}});
$("#ast").addEventListener("submit",async e=>{e.preventDefault();const m=$("#asm");
 try{const r=await post({action:"status",code:$("#astc").value});say(m,"Status: "+r.status+" (received "+new Date(r.received).toLocaleDateString("en-GB")+")",true)}catch(x){say(m,x.message,false)}});
})();
