// Public sermons and resources library: search, filter, featured, audio player, YouTube embed.
(()=>{
const KIND={sermon:"Sermon",audio:"Audio message",video:"Video teaching",study:"Bible study",discipleship:"Discipleship",devotional:"Devotional"};
const AUDIO=/\.(mp3|m4a|wav|ogg)(\?.*)?$/i,PDF=/\.pdf(\?.*)?$/i;
const yt=u=>{try{const x=new URL(u),h=x.hostname.replace(/^www\./,"");let id=h==="youtu.be"?x.pathname.slice(1):(h==="youtube.com"||h==="m.youtube.com")?(x.searchParams.get("v")||(x.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)||[])[1]):"";return/^[\w-]{11}$/.test(id||"")?id:null}catch{return null}};
const media=r=>{if(!r.url)return"";const id=yt(r.url);
 if(id)return`<div class="vid" style="position:relative;padding-top:56.25%"><iframe loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;border:0" src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(r.title)}" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
 if(AUDIO.test(r.url))return`<audio controls preload="none" style="width:100%" src="${esc(r.url)}"></audio><p><a href="${esc(r.url)}" download rel="noopener">Download</a></p>`;
 return`<p><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">${PDF.test(r.url)?"Open PDF":"Open link"}</a></p>`};
const card=r=>`<article class="card"><small>${esc(KIND[r.kind]||r.kind)}${r.category?" · "+esc(r.category):""}</small><h3>${esc(r.title)}</h3><p class="k">${r.speaker?esc(r.speaker)+" · ":""}${esc(new Date(r.published_on+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}))}</p>${r.description?`<p>${esc(r.description)}</p>`:""}${media(r)}${r.body?`<details><summary>Read</summary><div style="white-space:pre-wrap">${esc(r.body)}</div></details>`:""}</article>`;
let all=[];
const show=()=>{const q=$("#rq").value.trim().toLowerCase(),k=$("#rk").value,c=$("#rc").value;
 const list=all.filter(r=>(!k||r.kind===k)&&(!c||r.category===c)&&(!q||(r.title+" "+(r.speaker||"")+" "+(r.category||"")+" "+(r.description||"")).toLowerCase().includes(q)));
 $("#rl").innerHTML=list.length?list.map(card).join(""):'<p class="empty">No resources match. Try a different search.</p>'};
(async()=>{try{const r=await fetch("/api/public?type=resources");all=r.ok?await r.json():[]}catch{all=[]}
 if(!all.length){$("#rl").innerHTML='<p class="empty">Resources will appear here soon.</p>';return}
 const f=all.filter(r=>r.is_featured);if(f.length){$("#feat").hidden=false;$("#featlist").innerHTML=f.slice(0,3).map(card).join("")}
 [...new Set(all.map(r=>r.category).filter(Boolean))].sort().forEach(c=>$("#rc").insertAdjacentHTML("beforeend",`<option>${esc(c)}</option>`));
 show();["input","change"].forEach(e=>{$("#rq").addEventListener(e,show);$("#rk").addEventListener(e,show);$("#rc").addEventListener(e,show)})})();
})();
