/* Solenary v10 | Secure Google Calendar two-way sync UI.
 * No Google client secret or refresh token belongs in a browser file.
 * The Supabase Edge Function handles OAuth, credentials and API updates.
 */
'use strict';
(() => {
  const client=window.daymarkClient;
  if(!client)return;
  const $=id=>document.getElementById(id);
  const status=$('googleConnectionStatus');
  const unconnected=$('googleDisconnected');
  const connected=$('googleConnected');
  const connectButton=$('googleConnect');
  const syncButton=$('googleSyncNow');
  const saveButton=$('googleSaveOptions');
  const disconnectButton=$('googleDisconnect');
  const calendarSelect=$('googleCalendarSelect');
  const writeBack=$('googleWriteBack');
  const lastSync=$('googleLastSync');
  const results=$('googleSyncResults');
  let busy=false,connectedState=false,configured=false,lastSynced=null;
  let latest={};
  const fmt=s=>s ? new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Never';
  function setStatus(message,error=false){
    status.textContent=message;
    status.classList.toggle('google-sync-error',Boolean(error));
    status.setAttribute('role',error?'alert':'status');
  }
  function setBusy(value){
    busy=value;
    [connectButton,syncButton,saveButton,disconnectButton].forEach(el=>el.disabled=value);
  }
  async function call(action,more={}){
    const {data,error}=await client.functions.invoke('google-calendar',{
      body:{action,...more},
    });
    if(error){
      // Supabase may return a detailed JSON body alongside a non-2xx error.
      let msg=error.message||'Google Calendar connection failed';
      try {const body=await error.context?.json();if(body?.error)msg=body.error;}catch{}
      if(/not found|404/i.test(msg))msg='Google sync is not installed on the server yet. Deploy the Supabase Edge Function first.';
      throw new Error(msg);
    }
    if(data?.error)throw new Error(data.error);
    return data;
  }
  async function loadStatus(){
    if(busy)return;
    setBusy(true);setStatus('Checking Google connection…');
    try {
      latest=await call('status');
      connectedState=Boolean(latest.connected);
      unconnected.hidden=connectedState;
      connected.hidden=!connectedState;
      if(!connectedState){
        configured=false;setStatus('Not connected. Connect your Google account to synchronize one calendar.');
        return;
      }
      calendarSelect.replaceChildren();
      (latest.calendars||[]).forEach(c=>calendarSelect.add(new Option(`${c.name}${c.primary?' · Primary':''}`,c.id)));
      calendarSelect.value=latest.calendar_id;
      if(!calendarSelect.value && latest.calendars?.length)calendarSelect.value=latest.calendars[0].id;
      writeBack.checked=Boolean(latest.write_enabled);
      configured=true;lastSynced=latest.last_synced_at;
      lastSync.textContent=`Last successful sync: ${fmt(lastSynced)}`;
      results.textContent=latest.last_error||'';
      setStatus(latest.auth_error ? `Google authorization needs attention: ${latest.auth_error} Use Disconnect and reconnect to renew access.` :
        `Connected to ${latest.calendar_name}. ${latest.write_enabled?'Two-way writeback is enabled.':'Import only — enable writeback below for two-way sync.'}`,Boolean(latest.auth_error));
    }catch(e){setStatus(`Unable to check Google sync: ${e.message}`,true);}
    finally{setBusy(false);}
  }
  $('integrationsOpen')?.addEventListener('click',loadStatus);
  connectButton?.addEventListener('click',async()=>{
    if(busy)return;setBusy(true);setStatus('Opening Google authorization…');
    try{
      const result=await call('start');
      const u=new URL(result.authorization_url);
      if(u.origin!=='https://accounts.google.com')throw new Error('Unexpected OAuth destination');
      window.location.assign(u.toString());
    }catch(e){setStatus(e.message,true);setBusy(false);}
  });
  saveButton?.addEventListener('click',async()=>{
    if(busy)return;
    if(writeBack.checked&&!latest.write_enabled){
      const ok=confirm('Enable two-way synchronization? Solenary will create Google Calendar events for eligible tasks in the next year. Editing or deleting linked events on either side will affect the other. Continue?');
      if(!ok){writeBack.checked=false;return;}
    }
    setBusy(true);setStatus('Saving Google Calendar settings…');
    try{
      const result=await call('configure',{
        calendar_id:calendarSelect.value,write_enabled:writeBack.checked,
      });
      latest.write_enabled=result.write_enabled;
      latest.calendar_id=result.calendar_id;
      latest.calendar_name=result.calendar_name;
      setStatus(`Saved. ${result.write_enabled?'Two-way sync':'Import-only sync'} selected. Click Sync now to apply.`);
    }catch(e){setStatus(e.message,true);}
    finally{setBusy(false);}
  });
  async function runSync(silent=false){
    if(busy || !connectedState)return;
    setBusy(true);
    if(!silent)setStatus('Comparing Solenary events with Google Calendar…');
    try {
      const result=await call('sync');
      lastSynced=result.synced_at;
      lastSync.textContent=`Last successful sync: ${fmt(result.synced_at)}`;
      const c=result.counts||{};
      const changes=Object.entries({
        'Imported into Solenary':c.imported||0,
        'Created in Google':c.exported||0,
        'Updated in Google':c.googleUpdated||0,
        'Updated in Solenary':c.solenaryUpdated||0,
        'Removed from Google':c.googleDeleted||0,
        'Removed from Solenary':c.solenaryDeleted||0,
        'Unresolved conflicts':c.conflicts||0,
        'Skipped complex events':c.unsupported||0,
      }).filter(([,v])=>v>0).map(([k,v])=>`${k}: ${v}`).join(' · ');
      if(!silent)setStatus(changes||'Google Calendar and Solenary are up to date.');
      results.textContent=result.details||'';
      if(c.imported||c.solenaryUpdated||c.solenaryDeleted){
        window.dispatchEvent(new Event('solenary:calendar-synced'));
      }
    }catch(e){if(!silent)setStatus(`Sync failed: ${e.message}`,true);else console.warn('Solenary Google sync:',e.message);}
    finally{setBusy(false);}
  }
  syncButton?.addEventListener('click',()=>runSync(false));
  disconnectButton?.addEventListener('click',async()=>{
    if(!confirm('Disconnect Google Calendar? Solenary will stop synchronizing. Your existing Solenary tasks stay in your planner.'))return;
    setBusy(true);setStatus('Disconnecting Google…');
    try{await call('disconnect');connectedState=false;configured=false;latest={};
      unconnected.hidden=false;connected.hidden=true;results.textContent='';
      setStatus('Google Calendar disconnected. Existing Solenary tasks were preserved.');
    }catch(e){setStatus(e.message,true);}finally{setBusy(false);}
  });
  // While Solenary is actively open, periodically check for changes on either side.
  // For background synchronization with the app closed, configure an optional
  // Supabase Cron job invoking the same Edge Function's protected cron action.
  setInterval(()=>{
    if(document.visibilityState==='visible' && connectedState && lastSynced && !busy)
      runSync(true);
  },10*60*1000);
  const indicator=new URLSearchParams(window.location.search).get('google');
  if(indicator){
    setTimeout(()=>{
      const button=$('integrationsOpen');
      if(button){button.click();setStatus(indicator==='connected'?'Google connected. Choose sync options and click Sync now.':`Google connection: ${indicator}.`,indicator!=='connected');}
    },1100);
    const u=new URL(window.location.href);u.searchParams.delete('google');
    window.history.replaceState(null,'',u.pathname+u.search+u.hash);
  }
})();
