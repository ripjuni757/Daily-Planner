/* Solenary: approximate active-minute collection for signed-in accounts.
   The site discloses automatic collection in login.html, Settings and privacy.html.
   Never transmit keystrokes, task data, click details, page paths or mouse coordinates. */
'use strict';
(async function () {
  const client=window.daymarkClient;
  if(!client) return;
  const status=document.getElementById('usageConsentMessage');
  const deleteBtn=document.getElementById('usageDeleteHistory');
  let user=null;
  try {
    const result=await client.auth.getUser();
    if(result.error||!result.data?.user) return;
    user=result.data.user;
  } catch(_) {return;}
  let lastActivity=Date.now();
  let previousTick=Date.now();
  let accruedMs=0;
  let sending=false;
  let lastPointerSample=0;
  let stopped=false;
  const idleMs=75000;
  const report=(text,error=false)=>{if(status){status.textContent=text;status.classList.toggle('error',error);}};
  const touchActivity=()=>{lastActivity=Date.now();};
  for(const evt of ['pointerdown','keydown','touchstart','wheel'])
    document.addEventListener(evt,touchActivity,{passive:true});
  document.addEventListener('pointermove',()=>{
    const now=Date.now();
    if(now-lastPointerSample>12000){lastPointerSample=now;touchActivity();}
  },{passive:true});
  document.addEventListener('visibilitychange',()=>{
    previousTick=Date.now();
    if(document.visibilityState!=='visible') accruedMs=0;
  });
  window.addEventListener('blur',()=>{previousTick=Date.now();accruedMs=0;});
  window.addEventListener('focus',()=>{previousTick=Date.now();lastActivity=Date.now();});
  const active=()=>!stopped && document.visibilityState==='visible' && document.hasFocus()
    && Date.now()-lastActivity<=idleMs;
  async function tick(){
    const now=Date.now();
    const elapsed=Math.min(15000,Math.max(0,now-previousTick));
    previousTick=now;
    if(!active()){accruedMs=0;return;}
    accruedMs+=elapsed;
    if(accruedMs<60000||sending)return;
    accruedMs-=60000;
    sending=true;
    try {
      const {error}=await client.rpc('solenary_record_usage_minute');
      if(error) throw error;
    }catch(error){
      report('Usage analytics is not ready. The site owner must run usage-analytics.sql in Supabase.',true);
      console.warn('Solenary usage reporting unavailable:',error.code||error.message);
    }finally{sending=false;}
  }
  const timer=window.setInterval(tick,10000);
  client.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT'){stopped=true;accruedMs=0;window.clearInterval(timer);}
  });
  deleteBtn?.addEventListener('click',async()=>{
    if(deleteBtn.disabled)return;
    if(!window.confirm('Delete all previously recorded active-use minutes for your account? Tracking will still resume during future active sessions.'))return;
    deleteBtn.disabled=true;
    try{
      const {error}=await client.rpc('solenary_delete_my_usage');
      if(error)throw error;
      accruedMs=0;
      report('Previous usage history deleted. Automatic activity tracking continues during future sessions.');
    }catch(error){
      report('Could not delete usage history. Please try again.',true);
      console.warn('Usage history deletion failed:',error.code||error.message);
    }finally{deleteBtn.disabled=false;}
  });
})();
