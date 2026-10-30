(function(){
  var CITIES=[
    {code:"HTX", name:"Houston", href:"https://houstondeafnetwork.com", img:"https://images.pexels.com/photos/10893475/pexels-photo-10893475.jpeg?auto=compress&cs=tinysrgb&w=900", blurb:"Directory, events, and community, run by HoustonDeafNetwork since day one.", live:true},
    {code:"ATX", name:"Austin", href:"atx/", img:"https://images.pexels.com/photos/13684294/pexels-photo-13684294.jpeg?auto=compress&cs=tinysrgb&w=900", blurb:"Live directory of Deaf-friendly businesses, events, and community in Austin.", live:true},
    {code:"DFW", name:"Dallas - Fort Worth", href:"dfw/", img:"https://images.pexels.com/photos/11926780/pexels-photo-11926780.jpeg?auto=compress&cs=tinysrgb&w=900", blurb:"Live directory of Deaf-friendly businesses, events, and community in Dallas-Fort Worth.", live:true},
    {code:"SATX", name:"San Antonio", href:"satx/", img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/San_Antonio_River_Walk_at_night.jpg/960px-San_Antonio_River_Walk_at_night.jpg", blurb:"Live directory of Deaf-friendly businesses, events, and community in San Antonio.", live:true}
  ];
  function cesc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(x){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x];});}
  function joinNames(arr){
    if(arr.length<=1) return arr.join("");
    return arr.slice(0,-1).join(", ")+" and "+arr[arr.length-1];
  }
  var ul=document.querySelector(".city-list");
  if(ul){
    ul.innerHTML=CITIES.map(function(c){
      return '<li class="city '+(c.live?"live":"soon")+' is-link">'
        +'<span class="thumb"><img src="'+cesc(c.img)+'" alt="" loading="lazy"></span>'
        +'<div><p class="meta"><span class="code">'+cesc(c.code)+'</span></p>'
        +'<h3><a class="card-hit" href="'+cesc(c.href)+'">'+cesc(c.name)+'</a></h3>'
        +'<p>'+cesc(c.blurb)+'</p></div></li>';
    }).join("");
  }
  var liveNames=CITIES.filter(function(c){return c.live;}).map(function(c){return c.name;});
  var soonNames=CITIES.filter(function(c){return !c.live;}).map(function(c){return c.name;});
  var lede=document.getElementById("ledeStatus");
  if(lede){
    var lt=joinNames(liveNames)+" are all live today.";
    if(soonNames.length) lt+=" "+joinNames(soonNames)+" coming soon.";
    lede.textContent=lt;
  }
  var sr=document.getElementById("srCityStatus");
  if(sr){
    var st="City status card: "+joinNames(liveNames)+" are all live now.";
    if(soonNames.length) st+=" "+joinNames(soonNames)+" coming soon.";
    sr.textContent=st;
  }
})();

(function(){
  var mesh=document.getElementById("bgMesh"), sec=document.getElementById("cities");
  if(!mesh||!sec) return;
  function fit(){
    var bottom=sec.getBoundingClientRect().bottom + window.scrollY;
    mesh.style.height=Math.round(bottom+24)+"px";
  }
  window.addEventListener("load",fit);
  window.addEventListener("resize",fit);
  fit();
})();

(function(){
  var form=document.getElementById("suggestForm");
  if(!form) return;
  var status=document.getElementById("formStatus");
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    status.textContent="Sending..."; status.className="form-status";
    var btn=form.querySelector('button[type="submit"]'); if(btn) btn.disabled=true;
    var payload={
      name: document.getElementById("f-name").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      city: document.getElementById("f-city").value,
      listing_type: document.getElementById("f-type").value,
      message: document.getElementById("f-details").value.trim(),
      also_serves: Array.prototype.map.call(form.querySelectorAll("[name=also]:checked"), function(b){ return b.value; }),
      mx_check: (form.querySelector("[name=mx_check]")||{}).value || ""
    };
    fetch("https://echode-form-intake.longster.workers.dev/", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){ return {ok:false}; }); })
      .then(function(j){
        if(btn) btn.disabled=false;
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
        if(btn) btn.disabled=false;
        status.textContent="That did not send. Please try again in a bit.";
        status.className="form-status err";
      });
  });
})();
