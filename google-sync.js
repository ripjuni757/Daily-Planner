/* Solenary v11 | Google Calendar two-way synchronization.
 * OAuth and Google tokens stay in the existing Supabase Edge Function.
 * v11: debounced local writeback + automatic polling, resume, and error status.
 * Only the first import requires a deliberate click on "Sync now".
 */
'use strict';
(() => {
  const client = window.daymarkClient;
  if (!client) return;
  const $ = id => document.getElementById(id);
  const status = $('googleConnectionStatus');
  const unconnected = $('googleDisconnected');
  const connected = $('googleConnected');
  const connectButton = $('googleConnect');
  const syncButton = $('googleSyncNow');
  const saveButton = $('googleSaveOptions');
  const disconnectButton = $('googleDisconnect');
  const calendarSelect = $('googleCalendarSelect');
  const writeBack = $('googleWriteBack');
  const lastSync = $('googleLastSync');
  const results = $('googleSyncResults');
  const autoBox = $('googleAutoState');
  const autoHeading = $('googleAutoHeading');
  const autoText = $('googleAutoText');
  const modal = $('integrationsDialog');
  if (!status || !connectButton || !syncButton || !autoBox) return;

  const POLL_MS = 2 * 60 * 1000;
  const WRITE_DEBOUNCE_MS = 2400;
  const BACKOFF_MS = [15000, 45000, 120000, 300000];
  let busy = false;
  let connectedState = false;
  let loadedStatus = false;
  let latest = {};
  let lastSynced = null;
  let autoTimer = null;
  let needsSync = false;
  let failures = 0;
  let lastError = '';
  let lastAttemptAt = 0;

  const fmt = s => s ? new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Never';
  const isVisible = () => document.visibilityState !== 'hidden';
  const isOnline = () => navigator.onLine !== false;
  const autoReady = () => connectedState && Boolean(lastSynced);
  const isTwoWay = () => Boolean(latest.write_enabled);

  function setStatus(message,error=false) {
    status.textContent = message;
    status.classList.toggle('google-sync-error',Boolean(error));
    status.setAttribute('role',error?'alert':'status');
  }
  function autoState(state,title,description) {
    autoBox.dataset.state = state;
    autoHeading.textContent = title;
    autoText.textContent = description;
  }
  function setBusy(value) {
    busy = value;
    [connectButton,syncButton,saveButton,disconnectButton].forEach(el => {if(el)el.disabled=value;});
  }
  function cancelAuto() {
    if (autoTimer !== null) clearTimeout(autoTimer);
    autoTimer = null;
  }
  async function call(action,more={}) {
    const {data,error} = await client.functions.invoke('google-calendar',{body:{action,...more}});
    if (error) {
      let msg = error.message || 'Google Calendar connection failed';
      try {const body = await error.context?.json();if(body?.error)msg=body.error;} catch {}
      if (/not found|404/i.test(msg)) msg='Google sync backend not found. Deploy the google-calendar Supabase Edge Function first.';
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function loadStatus() {
    if (busy) return;
    setBusy(true);
    if (!loadedStatus) setStatus('Checking Google connection…');
    try {
      latest = await call('status');
      loadedStatus = true;
      connectedState = Boolean(latest.connected);
      unconnected.hidden = connectedState;
      connected.hidden = !connectedState;
      if (!connectedState) {
        lastSynced = null;
        needsSync = false;
        cancelAuto();
        setStatus('Not connected. Connect your Google account to synchronize a calendar.');
        return;
      }
      calendarSelect.replaceChildren();
      (latest.calendars||[]).forEach(c => calendarSelect.add(new Option(`${c.name}${c.primary?' · Primary':''}`,c.id)));
      calendarSelect.value = latest.calendar_id;
      if(!calendarSelect.value && latest.calendars?.length) calendarSelect.value=latest.calendars[0].id;
      writeBack.checked = Boolean(latest.write_enabled);
      lastSynced = latest.last_synced_at;
      lastSync.textContent = `Last successful sync: ${fmt(lastSynced)}`;
      results.textContent = latest.last_error || '';
      if (latest.auth_error) {
        setStatus(`Google authorization needs attention: ${latest.auth_error}. Reconnect to renew access.`,true);
        autoState('error','Connection needs attention','Open Integrations and reconnect Google Calendar.');
      } else {
        setStatus(`Connected to ${latest.calendar_name}. ${latest.write_enabled?'Two-way synchronization enabled.':'Import only — Google events can be read without writing back.'}`);
        autoState(lastSynced?'success':'paused',lastSynced?'Automatic checks on':'First import needed',
          lastSynced?'Checks every 2 minutes while Solenary is open. Saved changes sync automatically when two-way mode is on.':'Click Sync now once to import and start automatic updates.');
      }
    } catch(e) {
      lastError = e.message;
      setStatus(`Unable to check Google sync: ${e.message}`,true);
      autoState('error','Connection check failed','Try opening Integrations again.');
    } finally {
      setBusy(false);
      if(needsSync && autoReady()) scheduleAuto('pending',WRITE_DEBOUNCE_MS);
    }
  }
  function explainCounts(counts={}) {
    const labels={
      imported:'Imported into Solenary',exported:'Created in Google',googleUpdated:'Updated in Google',
      solenaryUpdated:'Updated in Solenary',googleDeleted:'Removed from Google',
      solenaryDeleted:'Removed from Solenary',conflicts:'Unresolved conflicts',
      unsupported:'Skipped complex events'
    };
    return Object.entries(labels).filter(([key])=>(counts[key]||0)>0)
      .map(([key,label])=>`${label}: ${counts[key]}`).join(' · ');
  }
  async function runSync(manual=false,reason='automatic') {
    if(!connectedState || busy) {
      if(!manual && connectedState) needsSync=true;
      return;
    }
    if(!manual && (!autoReady() || !isVisible() || !isOnline())) {
      needsSync=true;
      return;
    }
    cancelAuto();
    needsSync=false;
    setBusy(true);
    lastAttemptAt=Date.now();
    let retryDelay=null;
    autoState('working','Syncing calendar…',reason==='task'?'Sending your saved changes to Google.':'Checking both calendars for updates.');
    if(manual) setStatus('Comparing Solenary events with Google Calendar…');
    try {
      const result=await call('sync');
      const c=result.counts||{};
      const summary=explainCounts(c);
      failures=0;lastError='';
      lastSynced=result.synced_at;
      latest.last_synced_at=result.synced_at;
      lastSync.textContent=`Last successful sync: ${fmt(lastSynced)}`;
      results.textContent=result.details||'';
      autoState(c.conflicts?'error':'success',c.conflicts?'Conflict detected':'Calendars up to date',
        c.conflicts?'Both copies changed. Review differences before making further edits.':
        (summary || `Last checked ${fmt(result.synced_at)} · Automatic checks every 2 minutes while open.`));
      if(manual) setStatus(summary||'Google Calendar and Solenary are up to date.');
      if(c.imported||c.solenaryUpdated||c.solenaryDeleted) {
        window.dispatchEvent(new Event('solenary:calendar-synced'));
      }
    } catch(e) {
      lastError=String(e.message||e);
      const locked=/already running|\b409\b/i.test(lastError);
      if(!locked) failures+=1;
      autoState('error',locked?'Sync already running':'Sync needs attention',
        `${lastError}${!manual?' · Retrying automatically.':' · Click Sync now to retry.'}`);
      results.textContent=lastError;
      if(manual || modal?.open) setStatus(`Sync failed: ${lastError}`,true);
      // With a pending linked write, retry; otherwise the periodic poll will retry.
      if(!manual && isVisible() && isOnline()) {
        retryDelay=locked?12000:BACKOFF_MS[Math.min(Math.max(failures-1,0),BACKOFF_MS.length-1)];
        needsSync=true;
      }
    } finally {
      setBusy(false);
      // Changes saved DURING an in-flight sync need a follow-up pass.
      if(needsSync && isVisible() && isOnline() && autoReady() && autoTimer===null)
        scheduleAuto(retryDelay!==null?'retry':'pending',retryDelay ?? WRITE_DEBOUNCE_MS);
    }
  }
  function scheduleAuto(reason,delay=WRITE_DEBOUNCE_MS) {
    if(!connectedState || !lastSynced) return;
    if(!isVisible() || !isOnline()) {needsSync=true;return;}
    if(busy) {needsSync=true;return;}
    cancelAuto();
    if(reason==='retry') {
      autoState('error','Retry scheduled',`${lastError} · Will try again automatically.`);
    } else {
      autoState('working','Sync scheduled',reason==='task'?'Your saved change will sync shortly.':'Checking calendars shortly.');
    }
    autoTimer=setTimeout(()=>{autoTimer=null;runSync(false,reason);},delay);
  }

  $('integrationsOpen')?.addEventListener('click',()=>{loadStatus();});
  connectButton.addEventListener('click',async()=>{
    if(busy)return;
    setBusy(true);setStatus('Opening Google authorization…');
    try {
      const result=await call('start');
      const u=new URL(result.authorization_url);
      if(u.origin!=='https://accounts.google.com')throw new Error('Unexpected OAuth destination');
      window.location.assign(u.toString());
    } catch(e){setStatus(e.message,true);setBusy(false);}
  });
  saveButton.addEventListener('click',async()=>{
    if(busy)return;
    if(writeBack.checked && !latest.write_enabled) {
      const ok=confirm('Enable two-way synchronization? Solenary may create Google Calendar events for existing tasks in the next year. Editing or deleting linked events can change both calendars. Continue?');
      if(!ok) {writeBack.checked=false;return;}
    }
    cancelAuto();setBusy(true);setStatus('Saving Google Calendar settings…');
    try {
      const updated=await call('configure',{calendar_id:calendarSelect.value,write_enabled:writeBack.checked});
      latest={...latest,...updated};
      setStatus(`Saved. ${updated.write_enabled?'Two-way sync':'Import-only sync'} selected.${lastSynced?' Automatic syncing remains on.':' Click Sync now for the first import.'}`);
      autoState(lastSynced?'success':'paused',lastSynced?'Automatic sync on':'First import needed',
        lastSynced?'Local changes will sync automatically if two-way mode is enabled.':'Click Sync now once to begin.');
    }catch(e){setStatus(e.message,true);autoState('error','Could not save options',e.message);}
    finally{setBusy(false);}
  });
  syncButton.addEventListener('click',()=>runSync(true,'manual'));
  disconnectButton.addEventListener('click',async()=>{
    if(!confirm('Disconnect Google Calendar? Solenary will stop synchronizing. Your existing Solenary tasks stay in your planner.'))return;
    cancelAuto();setBusy(true);setStatus('Disconnecting Google…');
    try {
      await call('disconnect');connectedState=false;latest={};lastSynced=null;needsSync=false;failures=0;
      unconnected.hidden=false;connected.hidden=true;results.textContent='';
      setStatus('Google Calendar disconnected. Existing Solenary tasks were preserved.');
    }catch(e){setStatus(e.message,true);}finally{setBusy(false);}
  });

  // App persistence emits this only after Supabase accepts a task write/delete.
  // Local work is exported automatically only if the user enabled two-way mode.
  window.addEventListener('solenary:tasks-changed',()=>{
    if(!connectedState || !isTwoWay() || !lastSynced) return;
    needsSync=true;
    scheduleAuto('task',WRITE_DEBOUNCE_MS);
  });
  // Polling is a fallback for Google-side edits; it works with the tab visible.
  setInterval(()=>{
    if(!autoReady() || !isVisible() || !isOnline() || busy) return;
    if(Date.now()-lastAttemptAt<POLL_MS-5000) return;
    scheduleAuto('poll',1400);
  },POLL_MS);
  document.addEventListener('visibilitychange',()=>{
    if(isVisible() && autoReady() && Date.now()-lastAttemptAt>30000) scheduleAuto('resume',1600);
  });
  window.addEventListener('online',()=>{
    if(autoReady())scheduleAuto('reconnected',1500);
  });
  // Start observing connected status automatically, not only on opening the panel.
  const indicator=new URLSearchParams(window.location.search).get('google');
  setTimeout(()=>{
    if(indicator){
      $('integrationsOpen')?.click();
      setStatus(indicator==='connected'?'Google connected. Choose a calendar and click Sync now for the initial import.':`Google connection: ${indicator}.`,indicator!=='connected');
      const u=new URL(window.location.href);u.searchParams.delete('google');
      window.history.replaceState(null,'',u.pathname+u.search+u.hash);
    } else loadStatus();
  },1200);
})();
