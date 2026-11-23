// Public events page: upcoming programmes with registration, and a past-programmes archive.
(()=>{
const up=$("#up"),past=$("#past");
const when=e=>e.starts_at?new Date(e.starts_at).toLocaleString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"Africa/Lagos"}):(e.date||"");
const card=(e,isPast)=>`<article class="card" id="ev-${esc(e.id)}">${e.poster_url?`<img loading="lazy" src="${esc(e.poster_url)}" alt="Poster for ${esc(e.title)}">`:""}<h3>${esc(e.title)}</h3>
 <p class="k"><strong>When:</strong> ${esc(when(e))}</p>${e.venue?`<p class="k"><strong>Where:</strong> ${esc(e.venue)}</p>`:""}${e.details?`<p>${esc(e.details)}</p>`:""}
 ${isPast?"":e.full?`<p class="msg err">This event is full.</p>`:!e.can_register?`<p class="msg">Registration is closed.</p>`:`${e.spots_left!==null?`<p class="k"><strong>Spots left:</strong> ${e.spots_left}</p>`:""}
 <details><summary class="btn sm">Register</summary><form class="form evf" data-own data-id="${esc(e.id)}" novalidate>
 <label>Full name<input name="full_name" required maxlength="120" autocomplete="name"></label><label>Phone number<input name="phone" type="tel" required maxlength="30" autocomplete="tel"></label>
 <label>Email (optional, for a reminder)<input name="email" type="email" maxlength="200" autocomplete="email"></label>
 <label class="ck"><input type="checkbox" name="agree"> Email me a reminder before the event.</label>
 <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="btn">Confirm registration</button><p class="msg" role="status"></p></form></details>`}</article>`;
async function load(){
 try{const r=await fetch("/api/comms/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list"})});if(!r.ok)throw 0;const d=await r.json();
  up.innerHTML=d.upcoming.length?d.upcoming.map(e=>card(e,false)).join(""):'<p class="empty">No upcoming programmes yet. Check back soon.</p>';
  past.innerHTML=d.past.length?d.past.map(e=>card(e,true)).join(""):'<p class="empty">Nothing here yet.</p>'}
 catch{up.innerHTML='<p class="empty">Could not load events. Please refresh.</p>'}}
document.addEventListener("submit",async ev=>{const f=ev.target.closest(".evf");if(!f)return;ev.preventDefault();
 const m=$(".msg",f),b=$("button",f),v=Object.fromEntries(new FormData(f));
 if(!v.full_name.trim()||!v.phone.trim()){m.textContent="Enter your name and phone number.";m.className="msg err";return}
 b.disabled=true;m.textContent="";
 try{const r=await fetch("/api/comms/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"register",event_id:f.dataset.id,full_name:v.full_name,phone:v.phone,email:v.email,agree:!!v.agree,website:v.website})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Something went wrong.");
  m.textContent=j.message;m.className="msg ok";f.querySelectorAll("input,button").forEach(x=>x.disabled=true)}
 catch(x){m.textContent=x.message;m.className="msg err";b.disabled=false}});
load();
})();
