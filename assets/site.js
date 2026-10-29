const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mb=$(".menu");mb.onclick=()=>{const o=$("nav").classList.toggle("open");mb.setAttribute("aria-expanded",o)};
$$("form.form").forEach(f=>f.addEventListener("submit",async e=>{e.preventDefault();const m=$(".msg",f);m.className="msg";
 if(!f.checkValidity()){m.textContent="Please complete the required fields.";m.classList.add("err");return}
 const d=Object.fromEntries(new FormData(f));$$("input[type=checkbox]",f).forEach(c=>d[c.name]=c.checked);
 const b=$("button",f);b.disabled=true;
 try{const r=await fetch("/api/"+f.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});const j=await r.json();
  if(!r.ok)throw new Error(j.error||"Something went wrong.");f.reset();m.textContent=j.message||"Thank you. We received it.";m.classList.add("ok")}
 catch(x){m.textContent=x.message+" Please try again or email us.";m.classList.add("err")}finally{b.disabled=false}}));
const tpl={
 testimonies:t=>`<article class="card"><h3>${esc(t.title)}</h3><p>${esc(t.content)}</p><small>${esc(t.name||"Anonymous")}</small></article>`,
 members:m=>`<article class="card" data-s="${esc((m.full_name+" "+m.department).toLowerCase())}"><h3>${esc(m.full_name)}</h3><small>${esc(m.department)} · Level ${esc(m.level)}</small><p>${esc(m.bio)}</p></article>`,
 events:e=>`<article class="card"><h3>${esc(e.title)}</h3><small>${esc(e.date||"")} ${esc(e.venue||"")}</small><p>${esc(e.details)}</p></article>`,
 gallery:g=>`<figure class="card" data-c="${esc(g.category)}"><img loading="lazy" src="${esc(g.url)}" alt="${esc(g.caption||g.event)}"><figcaption>${esc(g.event)} <small>${esc(g.date||"")}</small></figcaption></figure>`};
$$("[data-src]").forEach(async el=>{try{const r=await fetch("/api/public?type="+el.dataset.src);if(!r.ok)return;const a=await r.json();
 if(a.length)el.innerHTML=a.map(tpl[el.dataset.src]).join("")}catch{}});
const q=$("#q");if(q)q.oninput=()=>$$("#mlist .card").forEach(c=>c.hidden=!c.dataset.s.includes(q.value.toLowerCase()));
if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js");
