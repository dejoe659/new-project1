// Academic help console, shared by the coordinator page and the admin "Academic help" tab. Self-contained.
// AcadConsole.mount(element, call) where call(body) -> Promise of the JSON reply (it adds the sign-in token).
(()=>{
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ST={new:"New",in_progress:"In progress",resolved:"Resolved",closed:"Closed"};
const when=d=>new Date(d).toLocaleString("en-GB",{timeZone:"Africa/Lagos"});
const dl=o=>"<dl>"+Object.entries(o).filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")+"</dl>";
window.AcadConsole={mount(el,call){
 let filter="",access=null,cat=[];
 const err=x=>{el.innerHTML=`<p class="msg err">${esc(x.message)}</p>`};
 async function home(){
  try{access=await call({action:"access"});const l=await call({action:"list",status:filter});
   let h=`<h2>Academic help <span class="tag">${access.role==="super_admin"?"super administrator":"faculty coordinator"}</span></h2><p><small>${access.role==="super_admin"?"You see every faculty.":"You see requests from: "+esc(access.faculties.map(f=>f.name).join(", "))+"."} Opening a request is recorded in the audit log.${access.can_update?"":" You can read requests but not change them."}</small></p>
   <label>Show<select id="af"><option value="">All</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${k===filter?"selected":""}>${v}</option>`).join("")}</select></label>`;
   h+=l.requests.length?l.requests.map(r=>`<div class="row"><h3>${esc(r.course)} <span class="tag">${esc(ST[r.status]||r.status)}</span></h3>${dl({Faculty:r.faculty,Department:r.department,Level:r.level,From:r.name,Received:when(r.created_at)})}<button data-ac="open" data-id="${r.id}">Open</button></div>`).join(""):"<p>No student requests yet. When a student sends one from the Academics page, it appears here.</p>";
   if(access.role==="super_admin")h+=await manage();
   el.innerHTML=h;
  }catch(x){err(x)}}
 async function manage(){
  const [c,f]=await Promise.all([call({action:"coords"}),call({action:"faculties"})]);cat=f.faculties;
  const fname=id=>(cat.find(x=>x.id===id)||{name:"?"}).name;
  let h=`<h2>Faculty coordinators</h2><p><small>${cat.length} faculties and ${cat.reduce((n,x)=>n+x.departments.length,0)} departments are loaded. Add a coordinator below, then tick the faculties they look after.</small></p><p><small>A coordinator is a limited account. They cannot open the admin dashboard or see anything outside their faculties. You choose what each one may do.</small></p>`;
  h+=c.coordinators.map(m=>`<div class="row" data-cid="${m.id}"><h3>${esc(m.name||m.email)} ${m.active?"":'<span class="tag">switched off</span>'}</h3>${dl({Email:m.email,Faculties:m.faculty_ids.map(fname).join(", ")})}
   <form class="form acf" data-id="${m.id}"><fieldset><legend>Faculties they look after</legend>${cat.map(x=>`<label class="ck"><input type="checkbox" name="fac" value="${x.id}" ${m.faculty_ids.includes(x.id)?"checked":""}> ${esc(x.name)}</label>`).join("")}</fieldset>
   <label class="ck"><input type="checkbox" name="can_view_contact" ${m.can_view_contact?"checked":""}> May see the student's phone and email</label>
   <label class="ck"><input type="checkbox" name="can_update" ${m.can_update?"checked":""}> May change status and add notes</label>
   <label class="ck"><input type="checkbox" name="active" ${m.active?"checked":""}> Account switched on</label>
   <button class="btn sm">Save access</button> <button type="button" class="btn sm ghost" data-ac="rpw" data-email="${esc(m.email)}">Reset password</button> <button type="button" class="no" data-ac="rmc" data-id="${m.id}">Remove coordinator</button><p class="msg" role="status"></p></form></div>`).join("")||"<p>No coordinators yet. Use the form below to create the first one.</p>";
  h+=`<h3>Add a coordinator</h3><form id="acn" class="form"><label>Full name<input name="name" maxlength="120"></label><label>Email (this is their sign-in)<input name="email" type="email" required></label><fieldset><legend>Faculties they will look after</legend>${cat.map(x=>`<label class="ck"><input type="checkbox" name="fac" value="${x.id}"> ${esc(x.name)}</label>`).join("")}</fieldset>
   <label class="ck"><input type="checkbox" name="can_view_contact" checked> May see the student's phone and email</label><label class="ck"><input type="checkbox" name="can_update" checked> May change status and add notes</label>
   <button class="btn">Create coordinator</button><p class="msg" id="acnm" role="status"></p></form>`;
  h+=`<h2>Reset a password</h2><p><small>Forgot your password, or a coordinator or administrator is locked out? Enter their email and you get a new temporary password to give them. They can change it after signing in with "Change my password".</small></p><form id="arp" class="form"><label>Email of the account<input name="email" type="email" required></label><button class="btn sm">Reset password</button><p class="msg" role="status"></p></form>`;
  h+=`<h2>Faculties and departments</h2><p><small>Fix any name that is wrong, or add what is missing.</small></p>`+cat.map(x=>`<details><summary>${esc(x.name)} (${x.departments.length})</summary>${x.departments.map(d=>`<div>${esc(d.name)} <button class="no" data-ac="rmd" data-id="${d.id}">Remove</button></div>`).join("")}<form class="form adf" data-f="${x.id}"><label>Add a department<input name="name" required maxlength="150"></label><button class="btn sm">Add</button></form></details>`).join("")+
   `<form id="afn" class="form"><label>Add a faculty<input name="name" required maxlength="120"></label><button class="btn sm">Add faculty</button></form>`;
  return h;}
 const checked=(form)=>[...form.querySelectorAll('input[name="fac"]:checked')].map(i=>i.value);
 el.addEventListener("change",e=>{if(e.target.id==="af"){filter=e.target.value;home()}});
 el.addEventListener("submit",async e=>{e.preventDefault();const f=e.target,m=f.querySelector(".msg");
  try{
   if(f.id==="acn"){const r=await call({action:"coord_add",name:f.elements.name.value,email:f.elements.email.value,faculty_ids:checked(f),can_view_contact:f.elements.can_view_contact.checked,can_update:f.elements.can_update.checked});
    await home();alert(r.login_created?`Coordinator created.\n\nGive them this sign-in:\nEmail: ${f.elements.email.value}\nTemporary password: ${r.temp_password}\nPage: ${location.origin}/coordinator\n\nThis password is shown only once. They can change it with "Forgot password?".`:"Coordinator added. That email already had a login, so they sign in with their existing password at "+location.origin+"/coordinator.");return}
   if(f.classList.contains("acf")){await call({action:"coord_update",id:f.dataset.id,faculty_ids:checked(f),can_view_contact:f.elements.can_view_contact.checked,can_update:f.elements.can_update.checked,active:f.elements.active.checked});m.textContent="Saved.";m.className="msg ok";return}
   if(f.classList.contains("adf")){await call({action:"dept_add",faculty_id:f.dataset.f,name:f.elements.name.value});return home()}
   if(f.id==="arp"){const r=await call({action:"reset_password",email:f.elements.email.value});f.reset();alert(`New temporary password for ${r.email||"that account"}:\n\n${r.temp_password}\n\nShown only once. Tell them to sign in and use "Change my password".`);return}
   if(f.id==="afn"){await call({action:"faculty_add",name:f.elements.name.value});return home()}
   if(f.id==="acu"){await call({action:"update",id:f.dataset.id,status:f.elements.status.value,coordinator_note:f.elements.note.value});m.textContent="Saved.";m.className="msg ok"}
  }catch(x){if(m){m.textContent=x.message;m.className="msg err"}else alert(x.message)}});
 el.addEventListener("click",async e=>{const b=e.target.closest("[data-ac]");if(!b)return;const a=b.dataset.ac,id=b.dataset.id;
  try{
   if(a==="back")return home();
   if(a==="rpw"){if(!confirm("Give "+b.dataset.email+" a new temporary password? Their old password stops working."))return;const r=await call({action:"reset_password",email:b.dataset.email});alert(`New temporary password for ${b.dataset.email}:\n\n${r.temp_password}\n\nShown only once. Send it to them and ask them to use "Change my password" after signing in.`);return}
   if(a==="rmc"){if(!confirm("Remove this coordinator? Their sign-in stops working here."))return;await call({action:"coord_remove",id});return home()}
   if(a==="rmd"){if(!confirm("Remove this department?"))return;await call({action:"dept_remove",id});return home()}
   if(a==="open"){const{request:r}=await call({action:"get",id});
    el.innerHTML=`<p><button data-ac="back">Back to requests</button></p><h2>${esc(r.course)}</h2>${dl({Faculty:r.faculty,Department:r.department,Level:r.level,From:r.name,Phone:r.phone,Email:r.email,Received:when(r.created_at),"Last handled by":r.handled_by})}${r.contact_hidden?"<p><small>Your account cannot see the student's contact details. Ask a super administrator to reach them.</small></p>":""}
    <p style="white-space:pre-wrap;border-left:3px solid #14451f;padding-left:.8rem">${esc(r.issue)}</p>
    ${access.can_update?`<form id="acu" class="form" data-id="${r.id}"><label>Status<select name="status">${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${k===r.status?"selected":""}>${v}</option>`).join("")}</select></label><label>Note (private, never shown to the student)<textarea name="note" rows="3" maxlength="2000">${esc(r.coordinator_note||"")}</textarea></label><button class="btn">Save</button><p class="msg" role="status"></p></form>`:""}`}
  }catch(x){alert(x.message)}});
 home();return{reload:home}}};
})();
