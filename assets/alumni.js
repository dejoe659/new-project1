// Alumni page: directory, join form, mentor request.
(()=>{
const post=async b=>{const r=await fetch("/api/comms/alumni",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Something went wrong.");return j};
const cat=async()=>{try{const r=await fetch("/api/comms/academic",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"faculties"})});return(await r.json()).faculties||[]}catch{return[]}};
const say=(el,t,ok)=>{el.textContent=t;el.className="msg "+(ok?"ok":"err")};
let all=[],faculties=[];
const card=a=>`<article class="card"><h3>${esc(a.full_name)}</h3><p><small>${esc(a.faculty)}${a.department?" · "+esc(a.department):""} · Class of ${a.graduation_year}</small></p>${a.occupation?`<p>${esc(a.occupation)}${a.location?", "+esc(a.location):""}</p>`:a.location?`<p>${esc(a.location)}</p>`:""}${a.bio?`<p>${esc(a.bio)}</p>`:""}${a.mentor?'<p><span class="tag">Willing to mentor</span></p>':""}</article>`;
const show=()=>{const q=$("#lq").value.trim().toLowerCase(),f=$("#lf").value,m=$("#lm").checked;
 const l=all.filter(a=>(!f||a.faculty===f)&&(!m||a.mentor)&&(!q||(a.full_name+" "+(a.occupation||"")+" "+(a.location||"")).toLowerCase().includes(q)));
 $("#ll").innerHTML=l.length?l.map(card).join(""):'<p class="empty">No alumni to show yet. Graduates, please join below!</p>'};
const deptFill=(fs,ds)=>{const x=faculties.find(c=>c.id===fs.value);ds.innerHTML=x?'<option value="">Choose your department</option>'+x.departments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")+'<option value="">Not listed</option>':'<option value="">Choose a faculty first</option>'};
(async()=>{
 const [l,f]=await Promise.all([post({action:"list"}).catch(()=>({alumni:[]})),cat()]);all=l.alumni;faculties=f;
 const opts='<option value="">Choose your faculty</option>'+f.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
 $("#jf").innerHTML=opts;$("#mf").innerHTML=opts;
 [...new Set(all.map(a=>a.faculty).filter(Boolean))].sort().forEach(n=>$("#lf").insertAdjacentHTML("beforeend",`<option>${esc(n)}</option>`));
 show();["input","change"].forEach(e=>{$("#lq").addEventListener(e,show);$("#lf").addEventListener(e,show);$("#lm").addEventListener(e,show)});
 $("#jf").addEventListener("change",()=>deptFill($("#jf"),$("#jd")));
})();
$("#alj").addEventListener("submit",async e=>{e.preventDefault();const f=e.target.elements,m=$("#ajm");
 try{const r=await post({action:"join",full_name:f.full_name.value,graduation_year:f.graduation_year.value,faculty_id:f.faculty_id.value,department_id:f.department_id.value,occupation:f.occupation.value,location:f.location.value,bio:f.bio.value,email:f.email.value,phone:f.phone.value,mentor:f.mentor.checked,consent_public:f.consent_public.checked,website:f.website.value});say(m,r.message,true);e.target.reset()}catch(x){say(m,x.message,false)}});
$("#alm").addEventListener("submit",async e=>{e.preventDefault();const f=e.target.elements,m=$("#amm");
 try{const r=await post({action:"mentor_request",faculty_id:f.faculty_id.value,message:f.message.value,name:f.name.value,phone:f.phone.value,email:f.email.value,website:f.website.value});say(m,r.message,true);e.target.reset()}catch(x){say(m,x.message,false)}});
})();
