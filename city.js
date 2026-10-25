(function(){
  if (typeof SITE_DATA === "undefined") return;
  var EXT='<svg class="ext" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>';
  var GLOBE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var FB='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
  var IG='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>';
  var LI='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>';
  function catsOf(d){ return (d.categories && d.categories.length) ? d.categories : (d.category ? [d.category] : []); }
  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function ok(u){return /^https?:\/\//i.test(u||"");}
  function btn(url,title,aria,svg){return '<a class="icon-btn" href="'+esc(url)+'" target="_blank" rel="noopener" title="'+title+'" aria-label="'+esc(aria)+'">'+svg+'</a>';}
  function linksHTML(r){
    var out="";
    if(ok(r.website)) out+=btn(r.website,"Website",r.name+" website, opens in a new tab",GLOBE);
    if(ok(r.facebook)) out+=btn(r.facebook,"Facebook",r.name+" on Facebook, opens in a new tab",FB);
    if(ok(r.instagram)) out+=btn(r.instagram,"Instagram",r.name+" on Instagram, opens in a new tab",IG);
    if(ok(r.linkedin)) out+=btn(r.linkedin,"LinkedIn",r.name+" on LinkedIn, opens in a new tab",LI);
    return out;
  }
  function cardHTML(r){
    var search=esc((r.name+" "+(r.description||"")+" "+catsOf(r).join(" ")).toLowerCase());
    var title=ok(r.website)
      ? '<a href="'+esc(r.website)+'" target="_blank" rel="noopener">'+esc(r.name)+EXT+'<span class="sr-only">(external site, opens in a new tab)</span></a>'
      : esc(r.name);
    var links=linksHTML(r);
    return '<article class="lcard'+(ok(r.website)?" is-link":"")+'" data-cat="'+esc(r.category)+'" data-cats="'+esc(catsOf(r).join("|"))+'" data-search="'+search+'">'
      +'<p class="dir-eyebrow">'+esc(r.category)+'</p><h3>'+title+'</h3>'
      +'<p class="dir-desc">'+esc(r.description)+'</p>'
      +(links?'<div class="dir-foot"><div class="card-links">'+links+'</div></div>':"")
      +'</article>';
  }
  var dir=SITE_DATA.directory||[];
  var grid=document.getElementById("dirGrid");
  if(grid) grid.innerHTML=dir.map(cardHTML).join("");
  var today=new Date(); today.setHours(0,0,0,0);
  var evs=(SITE_DATA.events||[]).filter(function(e){ if(!e.date) return true; return new Date(e.date+"T12:00:00")>=today; });
  var cats={}; dir.forEach(function(r){ catsOf(r).forEach(function(c){ cats[c]=1; }); });
  var stats={listings:dir.length, categories:Object.keys(cats).length, events:evs.length};
  Array.prototype.forEach.call(document.querySelectorAll("[data-stat]"),function(el){
    var k=el.getAttribute("data-stat"); if(k in stats) el.textContent=stats[k];
  });
  var se=document.getElementById("statEvents");
  if(se) se.innerHTML="<b>"+evs.length+"</b> upcoming event"+(evs.length===1?"":"s");
  function fmtDate(iso){ if(!iso) return ""; return new Date(iso+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}); }
  var elist=document.getElementById("eventList"), eempty=document.getElementById("eventsEmpty"), esub=document.getElementById("eventsSub");
  if(elist){
    elist.innerHTML=evs.map(function(e){
      var when=fmtDate(e.date); if(e.location) when=(when?when+" \u00b7 ":"")+e.location;
      var etitle=ok(e.link)?'<a href="'+esc(e.link)+'" target="_blank" rel="noopener">'+esc(e.name)+EXT+'<span class="sr-only">(external site, opens in a new tab)</span></a>':esc(e.name); var foot="";
      if(ok(e.link)){
        var isFb=/facebook\.com/i.test(e.link);
        foot='<div class="dir-foot"><div class="card-links">'+btn(e.link, isFb?"Facebook group":"Event page", e.name+(isFb?" Facebook group":" event page")+", opens in a new tab", isFb?FB:GLOBE)+'</div></div>';
      }
      return '<article class="evcard'+(ok(e.link)?" is-link":"")+'">'+(when?'<p class="when">'+esc(when)+'</p>':"")+'<h3>'+etitle+'</h3>'+(e.description?'<p class="desc">'+esc(e.description)+'</p>':"")+foot+'</article>';
    }).join("");
    if(eempty) eempty.hidden=evs.length>0;
    if(esub && evs.length>0 && esub.getAttribute("data-full")) esub.textContent=esub.getAttribute("data-full");
  }
  var er=document.getElementById("eventRow"), cn=document.getElementById("cardNextName"), cw=document.getElementById("cardNextWhen");
  if(cn && cw){
    if(evs.length){
      var nx=evs[0];
      cn.textContent=nx.name;
      cw.textContent=nx.date ? (new Date(nx.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}) + (nx.location ? " \u00b7 " + nx.location : "")) : (nx.location || "");
      if(er) er.hidden=false;
    } else {
      cn.textContent="Nothing scheduled yet";
      cw.textContent="New gatherings are added as they are announced.";
    }
  }
  var nr=document.getElementById("newsRow"), nw=SITE_DATA.news;
  if(nr && nw && nw.title && ok(nw.link)){
    document.getElementById("newsTitle").textContent=nw.title;
    document.getElementById("newsLink").href=nw.link;
    document.getElementById("newsDate").textContent=nw.date ? new Date(nw.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
    nr.hidden=false;
  }
  var jobs=SITE_DATA.postings||[];
  var jlist=document.getElementById("jobList"), jempty=document.getElementById("jobsEmpty"), jsub=document.getElementById("jobsSub");
  if(jlist){
    jlist.innerHTML=jobs.length? '<ul class="lgrid">'+jobs.map(cardHTML).join("")+'</ul>' : "";
    if(jempty) jempty.hidden=jobs.length>0;
    if(jsub && jobs.length>0 && jsub.getAttribute("data-full")) jsub.textContent=jsub.getAttribute("data-full");
  }
})();

(function(){
  var nav=document.getElementById("cityNav"), tgl=document.getElementById("navToggle");
  tgl.addEventListener("click",function(){
    var open=nav.classList.toggle("open");
    tgl.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click",function(e){ if(e.target.tagName==="A"){ nav.classList.remove("open"); tgl.setAttribute("aria-expanded","false"); }});
  var input=document.getElementById("directory-search"),
      panel=document.getElementById("categoryPanel"),
      ft=document.getElementById("filterToggle"),
      meta=document.getElementById("searchMeta"),
      count=document.getElementById("searchCount"),
      af=document.getElementById("activeFilter"),
      clear=document.getElementById("searchClear"),
      empty=document.getElementById("directoryEmpty"),
      cards=Array.prototype.slice.call(document.querySelectorAll(".lcard")),
      tagBtns=Array.prototype.slice.call(document.querySelectorAll("#categoryTags button")),
      activeCat="";
  ft.addEventListener("click",function(){
    var open=panel.hasAttribute("hidden");
    if(open){ panel.removeAttribute("hidden"); } else { panel.setAttribute("hidden",""); }
    ft.setAttribute("aria-expanded", open ? "true" : "false");
  });
  function apply(){
    var q=input.value.trim().toLowerCase(), shown=0;
    cards.forEach(function(c){
      var ok=(!activeCat || (c.getAttribute("data-cats")||"").split("|").indexOf(activeCat)>-1) && (!q || c.getAttribute("data-search").indexOf(q)>-1);
      c.style.display=ok ? "" : "none";
      if(ok) shown++;
    });
    var filtering=!!(q || activeCat);
    meta.hidden=!filtering;
    empty.hidden=shown!==0;
    if(filtering){
      count.textContent="Showing " + shown + " of " + cards.length + " listings";
      af.textContent="";
      if(activeCat){ af.appendChild(document.createTextNode("Filtered by: ")); var st=document.createElement("strong"); st.textContent=activeCat; af.appendChild(st); }
      if(q){ if(activeCat) af.appendChild(document.createTextNode(" \u00b7 ")); af.appendChild(document.createTextNode("\u201C" + input.value.trim() + "\u201D")); }
    }
  }
  input.addEventListener("input", apply);
  tagBtns.forEach(function(b){
    b.addEventListener("click",function(){
      activeCat=b.getAttribute("data-filter") || "";
      tagBtns.forEach(function(x){ x.setAttribute("aria-pressed", x===b ? "true" : "false"); });
      apply();
    });
  });
  clear.addEventListener("click",function(){
    input.value=""; activeCat="";
    tagBtns.forEach(function(x){ x.setAttribute("aria-pressed", x.getAttribute("data-filter")==="" ? "true" : "false"); });
    apply(); input.focus();
  });
})();

(function(){
  var form=document.getElementById("gform");
  if(!form) return;
  var status=document.getElementById("gStatus");
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    status.textContent="Sending..."; status.className="form-status";
    var payload={
      name: document.getElementById("g-name").value.trim(),
      email: document.getElementById("g-email").value.trim(),
      city: form.getAttribute("data-city") || "",
      listing_type: document.getElementById("g-type").value,
      message: document.getElementById("g-details").value.trim(),
      also_serves: Array.prototype.map.call(form.querySelectorAll("[name=also]:checked"), function(b){ return b.value; }),
      company: (form.querySelector("[name=company]")||{}).value || ""
    };
    fetch("https://echode-form-intake.longster.workers.dev/", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){ return {ok:false}; }); })
      .then(function(j){
        if(j && j.ok){
          form.reset();
          status.textContent="Thanks, your suggestion is in the review queue. A person reads every one before anything goes live.";
          status.className="form-status ok";
        } else {
          status.textContent="That did not send. Please check the fields and try again.";
          status.className="form-status err";
        }
      })
      .catch(function(){
        status.textContent="That did not send. Please try again in a bit.";
        status.className="form-status err";
      });
  });
})();
