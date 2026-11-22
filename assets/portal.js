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
const row=(k,v)=>`<p class="k"><strong>${k}:</strong> ${esc(v||"Not set")}</p>`;
function render(d){const m=d.member,a=d.attendance;
 $a.hidden=true;$app.hidden=false;
 const status=m.review_status==="approved"?"Approved member":"Waiting for a leader to approve your registration";
 $app.innerHTML=`<p><img class="avatar" src="${m.photo_url?esc(m.photo_url):"/assets/avatar.svg"}" alt="Your photo" width="96" height="96"></p>
 <p><strong>${esc(m.full_name)}</strong> · ${esc(status)} <button class="btn sm" id="out" type="button">Sign out</button></p>
 <h2>Your details</h2>${row("Department in the fellowship",m.department)}${row("Course of study",m.course)}${row("Faculty",m.faculty)}${row("Level",m.level)}${row("Phone",m.phone)}${row("Email",m.email)}${row("Hostel or address",m.hostel_address)}${row("Skills or business",m.skills_business)}${row("Bio",m.bio)}${row("Registered on",new Date(m.created_at).toLocaleDateString("en-GB"))}
 <p><small>Your details can only be changed by a leader. If something is wrong, tell a leader and they will correct it.</small></p>
 <h2>Your attendance</h2><p>You have been marked present <strong>${a.attended}</strong> time${a.attended===1?"":"s"}.</p>${a.recent.length?`<ul>${a.recent.map(x=>`<li>${esc(x.kind)}, ${esc(x.date)}</li>`).join("")}</ul>`:""}`;
 $("#out").onclick=async()=>{await sb.auth.signOut();location.href="/portal"}}
let busy=false;
async function start(){
 if(busy)return;busy=true;try{
 const{data:{session}}=await sb.auth.getSession();if(!session)return;
 try{render(await call({action:"me"}))}
 catch(x){$a.hidden=false;$app.hidden=true;say(am,x.message);if(x.code===401)await sb.auth.signOut()}}finally{busy=false}}
sb.auth.onAuthStateChange((ev)=>{if(ev==="SIGNED_IN")start()});
start();
})();
