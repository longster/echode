document.getElementById("year").textContent=new Date().getFullYear();

(function(){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;var names=["driftL","driftR"];document.querySelectorAll(".bg-aurora i").forEach(function(el){el.style.animationName=names[Math.floor(Math.random()*names.length)];el.style.animationDuration=(13+Math.random()*8).toFixed(1)+"s";el.style.animationDelay=(-Math.random()*20).toFixed(1)+"s";el.style.animationDirection="normal";el.style.rotate=((Math.random()*56)-28).toFixed(0)+"deg";});})();

(function(){var b=document.getElementById('themeToggle');if(!b)return;var mq=window.matchMedia('(prefers-color-scheme: dark)');function apply(m){document.documentElement.setAttribute('data-mode',m);var d=m==='dark'||(m==='auto'&&mq.matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');b.setAttribute('aria-label','Theme: '+m+'. Switch theme');}b.addEventListener('click',function(){var m=document.documentElement.getAttribute('data-mode')||'auto';var n=m==='auto'?'light':(m==='light'?'dark':'auto');try{localStorage.setItem('echode-theme',n);}catch(e){}apply(n);});if(mq.addEventListener){mq.addEventListener('change',function(){if((document.documentElement.getAttribute('data-mode')||'auto')==='auto'){apply('auto');}});}apply(document.documentElement.getAttribute('data-mode')||'auto');})();

(function(){
  // AI chat widget. No-ops on pages without the widget markup
  // (Privacy, Design). The Worker URL goes live at launch; until
  // then the button opens a panel whose sends fail politely.
  var box=document.querySelector(".aichat"); if(!box) return;
  var CHAT_URL="https://echode-ai-chat.longster.workers.dev/";
  var btn=document.getElementById("aiChatBtn"), panel=document.getElementById("aiChatPanel"),
      close=document.getElementById("aiChatClose"), form=document.getElementById("aiChatForm"),
      input=document.getElementById("aiChatInput"), log=document.getElementById("aiChatLog"),
      status=document.getElementById("aiChatStatus"), city=box.getAttribute("data-city")||"ALL";
  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function open(){ panel.hidden=false; btn.setAttribute("aria-expanded","true"); input.focus(); }
  function shut(){ panel.hidden=true; btn.setAttribute("aria-expanded","false"); btn.focus(); }
  btn.addEventListener("click",function(){ if(panel.hidden){ open(); } else { shut(); } });
  close.addEventListener("click",shut);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"&&!panel.hidden) shut(); });
  function addMsg(cls,html){ var p=document.createElement("p"); p.className="aichat-msg "+cls; p.innerHTML=html; log.appendChild(p); log.scrollTop=log.scrollHeight; return p; }
  addMsg("ai","Ask me about places, events, and jobs listed here. I answer only from the listings on this site.");
  form.addEventListener("submit",function(ev){
    ev.preventDefault();
    var q=input.value.trim(); if(!q) return;
    addMsg("user",esc(q)); input.value="";
    var send=form.querySelector('button[type="submit"]'); if(send) send.disabled=true;
    status.textContent="Thinking..."; status.className="form-status aichat-status";
    var thinking=addMsg("ai","...");
    fetch(CHAT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,city:city})})
      .then(function(r){ return r.json().catch(function(){ return {ok:false}; }); })
      .then(function(j){
        if(send) send.disabled=false;
        thinking.remove();
        if(j&&j.ok){
          var html=esc(j.answer);
          if(j.sources&&j.sources.length) html+='<span class="src">Sources: '+j.sources.map(esc).join(", ")+"</span>";
          addMsg("ai",html);
          status.textContent="";
        } else if(j&&j.error==="daily_limit"){
          status.textContent="That is the daily limit for the chat. Please try again tomorrow.";
          status.className="form-status aichat-status err";
        } else {
          status.textContent="That did not send. Please try again in a bit.";
          status.className="form-status aichat-status err";
        }
      })
      .catch(function(){
        if(send) send.disabled=false;
        thinking.remove();
        status.textContent="That did not send. Please try again in a bit.";
        status.className="form-status aichat-status err";
      });
  });
})();
