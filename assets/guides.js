// Freshers' guide and academic support pages: published library entries of one kind, searchable.
(()=>{
const kind=document.body.dataset.kind,list=$("#gl");
const card=r=>`<article class="card">${r.category?`<small>${esc(r.category)}</small>`:""}<h3>${esc(r.title)}</h3>${r.description?`<p>${esc(r.description)}</p>`:""}${r.body?`<details><summary>Read more</summary><div style="white-space:pre-wrap">${esc(r.body)}</div></details>`:""}${r.url?`<p><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open resource</a></p>`:""}</article>`;
let all=[];
const show=()=>{const q=$("#gq").value.trim().toLowerCase(),c=$("#gc").value;
 const l=all.filter(r=>(!c||r.category===c)&&(!q||(r.title+" "+(r.category||"")+" "+(r.description||"")+" "+(r.body||"")).toLowerCase().includes(q)));
 list.innerHTML=l.length?l.map(card).join(""):'<p class="empty">Nothing matches. Try a different search, or ask us on the Prayer page.</p>'};
(async()=>{let r;try{const x=await fetch("/api/public?type=resources");r=x.ok?await x.json():[]}catch{r=[]}
 all=r.filter(x=>x.kind===kind);
 if(!all.length){list.innerHTML='<p class="empty">Guides will appear here soon. In the meantime, reach us on WhatsApp.</p>';return}
 [...new Set(all.map(x=>x.category).filter(Boolean))].sort().forEach(c=>$("#gc").insertAdjacentHTML("beforeend",`<option>${esc(c)}</option>`));
 show();["input","change"].forEach(e=>{$("#gq").addEventListener(e,show);$("#gc").addEventListener(e,show)})})();
})();
