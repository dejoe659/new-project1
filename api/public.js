const {db}=require("./_lib");
// Public reads expose only approved rows and safe columns. Never phone, email or student details.
const Q={testimonies:"testimonies?status=in.(approved,published)&select=title,content,name&order=created_at.desc&limit=30",
 members:"members?profile_approved=eq.true&consent_public=eq.true&select=full_name,department,level,bio&order=full_name",
 events:"events?select=title,date,venue,details&order=date.asc&limit=20",
 gallery:"gallery?select=event,date,caption,category,url&order=date.desc&limit=60"};
module.exports=async(req,res)=>{const q=Q[req.query.type];if(!q)return res.status(400).json([]);
 try{const r=await db(q);res.setHeader("Cache-Control","s-maxage=60");res.status(200).json(r)}catch{res.status(200).json([])}};
