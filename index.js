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
    var payload={
      name: document.getElementById("f-name").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      city: document.getElementById("f-city").value,
      listing_type: document.getElementById("f-type").value,
      message: document.getElementById("f-details").value.trim(),
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
