// Member portal. Sign-in is a one-time email link (Supabase Auth). All reads and changes go through /api/comms/portal, which only ever touches the signed-in member's own record.
(()=>{
const sb=supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
const $a=$("#auth"),$app=$("#app"),am=$("#am");
const say=(el,t,ok)=>{el.textContent=t;el.className="msg "+(ok?"ok":"err")};
const call=async(body)=>{const{data:{session}}=await sb.auth.getSession();if(!session)throw new Error("Please sign in.");
 const r=await fetch("/api/comms/portal",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||"Something went wrong.");e.code=r.status;throw e}return j};
$("#signin").onsubmit=async e=>{e.preventDefault();const em=$("#em").value.trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return say(am,"Enter a valid email address.");
 const b=e.target.querySelector("button");b.disabled=true;say(am,"");
 const{error}=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin+"/portal"}});
 b.disabled=false;if(error)return say(am,/rate|seconds|limit/i.test(error.message)?"Too many requests. Wait a few minutes and try again.":"Could not send the link. Try again.");
 say(am,"Check your email for the sign-in link (look in spam too). Open it on this phone or computer.",true)};
const field=(l,id,v,o={})=>`<label>${l}${o.area?`<textarea id="${id}" rows="3" maxlength="${o.max||600}">${esc(v||"")}</textarea>`:`<input id="${id}" value="${esc(v||"")}" ${o.type?`type="${o.type}"`:""} maxlength="${o.max||200}" ${o.ph?`placeholder="${o.ph}"`:""}>`}</label>`;
const row=(k,v)=>`<p class="k"><strong>${k}:</strong> ${esc(v||"Not set")}</p>`;
let photo=null;
function render(d){const m=d.member,a=d.attendance;
 $a.hidden=true;$app.hidden=false;
 const status=m.review_status==="approved"?"Approved member":"Waiting for a leader to approve your registration";
 $app.innerHTML=`<p><strong>${esc(m.full_name)}</strong> · ${esc(status)} <button class="btn sm" id="out" type="button">Sign out</button></p>
 <h2>Your fellowship details</h2>${row("Department in the fellowship",m.department)}${row("Registered on",new Date(m.created_at).toLocaleDateString("en-GB"))}
 <p><small>Your name, department and approval are managed by leaders. Ask a leader if one of them is wrong.</small></p>
 <h2>Your attendance</h2><p>You have been marked present <strong>${a.attended}</strong> time${a.attended===1?"":"s"}.</p>${a.recent.length?`<ul>${a.recent.map(x=>`<li>${esc(x.kind)}, ${esc(x.date)}</li>`).join("")}</ul>`:""}
 <h2>Update your details</h2><form id="pf" class="form" novalidate>
 <img class="avatar" id="pv" src="${m.photo_url?esc(m.photo_url):"/assets/avatar.svg"}" alt="Your photo" width="96" height="96"><label>Change photo (JPG, PNG or WebP)<input id="ph" type="file" accept="image/jpeg,image/png,image/webp"></label>
 ${field("Phone number","phone",m.phone,{type:"tel",max:30})}${field("Hostel or residential address","hostel_address",m.hostel_address,{max:300})}
 ${field("Faculty","faculty",m.faculty,{max:100})}${field("Course of study","course",m.course,{max:120})}
 <label>Level<select id="level">${["100","200","300","400","500","600","700"].map(l=>`<option ${l===m.level?"selected":""}>${l}</option>`).join("")}</select></label>
 ${field("Skills or business","skills_business",m.skills_business,{area:1,max:300})}${field("Short bio","bio",m.bio,{area:1})}${field("Departments you are interested in","interests",m.interests,{max:300})}
 <label class="ck"><input type="checkbox" id="cp" ${m.consent_public?"checked":""}> Show my public profile on the Members page (after a leader approves it).</label>
 <p><small>Your bio, skills and photo appear on the website. When you change them, a leader approves them again before they show.</small></p>
 <button class="btn">Save changes</button><p class="msg" id="pm" role="status"></p></form>`;
 $("#out").onclick=async()=>{await sb.auth.signOut();location.href="/portal"};
 $("#ph").onchange=async e=>{const f=e.target.files[0];if(!f)return;const pm=$("#pm");try{say(pm,"Uploading photo...",true);photo=await uploadPhoto(f);$("#pv").src=photo;say(pm,"Photo ready. Tap Save changes.",true)}catch(x){photo=null;say(pm,x.message)}};
 $("#pf").onsubmit=async e=>{e.preventDefault();const pm=$("#pm"),b=e.target.querySelector("button");b.disabled=true;say(pm,"");
  const body={action:"save",phone:$("#phone").value,hostel_address:$("#hostel_address").value,faculty:$("#faculty").value,course:$("#course").value,level:$("#level").value,skills_business:$("#skills_business").value,bio:$("#bio").value,interests:$("#interests").value,consent_public:$("#cp").checked};
  if(photo)body.photo_url=photo;
  try{const r=await call(body);photo=null;say(pm,r.message,true)}catch(x){say(pm,x.message)}finally{b.disabled=false}}}
let busy=false;
async function start(){
 if(busy)return;busy=true;try{
 const{data:{session}}=await sb.auth.getSession();if(!session)return;
 try{render(await call({action:"me"}))}
 catch(x){$a.hidden=false;$app.hidden=true;say(am,x.message);if(x.code===401)await sb.auth.signOut()}}finally{busy=false}}
sb.auth.onAuthStateChange((ev)=>{if(ev==="SIGNED_IN")start()});
start();
})();
