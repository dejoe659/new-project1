const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mb=$(".menu");mb.onclick=()=>{const o=$("nav").classList.toggle("open");mb.setAttribute("aria-expanded",o)};
const SB_URL="https://takdaiqvaxancqrqwwhy.supabase.co",SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRha2RhaXF2YXhhbmNxcnF3d2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDkyNDUsImV4cCI6MjEwODc4NTI0NX0.cMNEb_tr1gRtVRwJa5kQqvqctyR9UjdroJ34umG4L8Q";
// Shrink the photo in the browser (max 800px, JPEG) so uploads are small and fast on mobile data.
const shrink=async f=>{if(!/^image\//.test(f.type))throw new Error("Please choose an image file.");const i=await createImageBitmap(f),s=Math.min(1,800/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.round(i.width*s);c.height=Math.round(i.height*s);c.getContext("2d").drawImage(i,0,0,c.width,c.height);
 return new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(new Error("Could not read that photo.")),"image/jpeg",.85))};
const uploadPhoto=async f=>{if(f.size>10485760)throw new Error("That photo is too large (max 10 MB).");const b=await shrink(f),n=crypto.randomUUID()+".jpg";
 const r=await fetch(SB_URL+"/storage/v1/object/member-photos/"+n,{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"image/jpeg"},body:b});
 if(!r.ok)throw new Error("Photo upload failed.");return SB_URL+"/storage/v1/object/public/member-photos/"+n};
$$("form.form").forEach(f=>f.addEventListener("submit",async e=>{e.preventDefault();const m=$(".msg",f);m.className="msg";
 if(!f.checkValidity()){m.textContent="Please complete the required fields.";m.classList.add("err");return}
 const d=Object.fromEntries(new FormData(f));delete d.photo;$$("input[type=checkbox]",f).forEach(c=>d[c.name]=c.checked);
 const b=$("button",f);b.disabled=true;
 try{const pf=$("input[name=photo]",f);if(pf&&pf.files[0])d.photo_url=await uploadPhoto(pf.files[0]);const r=await fetch("/api/"+f.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});const j=await r.json();
  if(!r.ok)throw new Error(j.error||"Something went wrong.");f.reset();m.textContent=j.message||"Thank you. We received it.";m.classList.add("ok")}
 catch(x){m.textContent=x.message+" Please try again or email us.";m.classList.add("err")}finally{b.disabled=false}}));
const tpl={
 testimonies:t=>`<article class="card"><h3>${esc(t.title)}</h3><p>${esc(t.content)}</p><small>${esc(t.name||"Anonymous")}</small></article>`,
 members:m=>`<article class="card" data-s="${esc((m.full_name+" "+(m.department||"")+" "+(m.course||"")).toLowerCase())}"><img class="avatar" loading="lazy" src="${m.photo_url?esc(m.photo_url):"/assets/avatar.svg"}" alt="${esc(m.full_name)}"><h3>${esc(m.full_name)}</h3><small>${m.course?"Studies "+esc(m.course)+" · ":""}Level ${esc(m.level)}</small>${m.department&&m.department.toLowerCase()!=="none yet"?`<p class="k"><strong>Fellowship department:</strong> ${esc(m.department)}</p>`:""}<p>${esc(m.bio)}</p></article>`,
 events:e=>`<article class="card"><h3>${esc(e.title)}</h3><small>${esc(e.date||"")} ${esc(e.venue||"")}</small><p>${esc(e.details)}</p></article>`,
 gallery:g=>`<figure class="card" data-c="${esc(g.category)}"><img loading="lazy" src="${esc(g.url)}" alt="${esc(g.caption||g.event)}"><figcaption>${esc(g.event)} <small>${esc(g.date||"")}</small></figcaption></figure>`};
$$("[data-src]").forEach(async el=>{try{const r=await fetch("/api/public?type="+el.dataset.src);if(!r.ok)return;const a=await r.json();
 if(a.length)el.innerHTML=a.map(tpl[el.dataset.src]).join("")}catch{}});
const q=$("#q");if(q)q.oninput=()=>$$("#mlist .card").forEach(c=>c.hidden=!c.dataset.s.includes(q.value.toLowerCase()));
if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js");
