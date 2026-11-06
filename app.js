'use strict';
(async () => {
  const boot = document.getElementById('bootScreen');
  const client = window.daymarkClient;
  if (!client) {
    boot.innerHTML = 'Daymark needs Supabase configuration. Open <strong>supabase-config.js</strong> and follow the setup steps in README.md.';
    return;
  }
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) {
    location.replace('login.html');
    return;
  }
  const user = authData.user;
  const userId = user.id;

  const STORE_KEY = 'daymark.planner.tasks.v1';
  const SETTINGS_KEY = `daymark.planner.settings.v2.${userId}`;
  const NOTIFIED_KEY = `daymark.planner.notified.v2.${userId}`;
  const defaultSettings = { weekStart: 1, timeFormat: 12, duration: 60, notifications: false };
  const $ = (id) => document.getElementById(id);
  const today = () => new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const fromKey = (s) => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y,m-1,d); };
  const addDays = (d, n) => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; };
  const addMonths = (d, n) => new Date(d.getFullYear(),d.getMonth()+n,Math.min(d.getDate(),new Date(d.getFullYear(),d.getMonth()+n+1,0).getDate()));
  const weekStartDate = (d) => addDays(d,-((d.getDay()-Number(settings.weekStart)+7)%7));
  const fmtDate = (d, options) => new Intl.DateTimeFormat('en-US',options).format(d);
  const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const minutes = (t) => { const [h,m]=String(t||'00:00').split(':').map(Number); return h*60+m; };
  const asTime = (mins) => `${pad(Math.floor(mins/60)%24)}:${pad(mins%60)}`;
  const randomId = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `dm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeLoad = (key, fallback) => { try { const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s||'') && dateKey(fromKey(s))===s;
  const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s||'');
  let settings = {...defaultSettings, ...safeLoad(SETTINGS_KEY,{})};
  let tasks = [];
  if (!Array.isArray(tasks)) tasks=[];
  // Load the authenticated user's rows in pages to avoid a database response-size limit.
  async function fetchCloudTasks() {
    const rows = [];
    const pageSize = 500;
    for (let offset = 0;; offset += pageSize) {
      const { data, error } = await client.from('daymark_tasks')
        .select('task').eq('user_id', userId)
        .order('task_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows.map(row => row.task)
      .filter(t => t && typeof t.title === 'string' && validDate(t.date));
  }
  try {
    tasks = await fetchCloudTasks();
  } catch (loadError) {
    boot.textContent = `Could not load your planner: ${loadError.message}. Check the Supabase SQL setup and refresh.`;
    return;
  }
  let selectedDate = today();
  let miniMonth = new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
  let view = 'week';
  let editingId = null;
  let toastTimer;
  let scrollToWorkHours = true;
  const isToday = (d) => dateKey(d)===dateKey(today());
  const isComplete = (t) => Boolean(t.completed);
  const taskColorClass = (t) => `cat-${t.kind === 'reminder' ? 'reminder' : ['work','study','personal','health'].includes(t.category) ? t.category : 'work'}`;
  const taskStartStamp = (t) => { const d = fromKey(t.date); const m = t.allDay ? 9*60 : minutes(t.start); d.setHours(Math.floor(m/60),m%60,0,0); return d.getTime(); };
  const taskComparator = (a,b) => taskStartStamp(a)-taskStartStamp(b) || a.title.localeCompare(b.title);
  const save = () => {
    try { localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); }
    catch { notify('This browser cannot save display settings.'); }
  };
  async function cloudUpsert(items) {
    // Small batches avoid excessive request sizes on large imports.
    for (let i = 0; i < items.length; i += 150) {
      const rows = items.slice(i, i+150).map(item => ({
        user_id: userId, task_id: item.id, task: item,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('daymark_tasks').upsert(rows, {onConflict:'user_id,task_id'});
      if (error) throw new Error(error.message);
    }
  }
  async function cloudDelete(ids) {
    for (let i = 0; i < ids.length; i += 150) {
      const { error } = await client.from('daymark_tasks').delete()
        .eq('user_id', userId).in('task_id', ids.slice(i,i+150));
      if (error) throw new Error(error.message);
    }
  }
  async function reloadCloud() {
    tasks = await fetchCloudTasks();
    render();
  }
  const notify = (msg) => { clearTimeout(toastTimer); $('toast').textContent=msg; $('toast').hidden=false; toastTimer=setTimeout(()=>{$('toast').hidden=true;},4500); };
  const showDialog = (id) => { const d=$(id); if (typeof d.showModal==='function') d.showModal(); };
  const closeDialog = (id) => { const d=$(id); if (d.open) d.close(); };
  const timeLabel = (time, noMinutes=false) => {
    if (!validTime(time)) return 'All day';
    const h=Number(time.slice(0,2)), m=Number(time.slice(3,5));
    if (Number(settings.timeFormat)===24) return `${pad(h)}:${pad(m)}`;
    return `${(h%12)||12}${noMinutes && m===0 ? '' : ':'+pad(m)} ${h>=12?'PM':'AM'}`;
  };
  const shortDate = (date) => fmtDate(date,{month:'short',day:'numeric'});
  const taskWhen = (t) => `${fmtDate(fromKey(t.date),{month:'short',day:'numeric',year:'numeric'})}${t.allDay?' · All day':' · '+timeLabel(t.start)}`;

  function render() {
    renderHeading(); renderMini(); renderSummary(); renderSidebar(); renderCalendar();
    $('weekButton').setAttribute('aria-pressed',String(view==='week'));
    $('monthButton').setAttribute('aria-pressed',String(view==='month'));
  }
  function renderHeading() {
    const start=weekStartDate(selectedDate),end=addDays(start,6);
    if (view==='week') {
      const sameMonth=start.getFullYear()===end.getFullYear() && start.getMonth()===end.getMonth();
      const sameYear=start.getFullYear()===end.getFullYear();
      const a=fmtDate(start,{month:'long',day:'numeric',...(sameYear?{}:{year:'numeric'})});
      const b=sameMonth ? `${end.getDate()}, ${end.getFullYear()}` : fmtDate(end,{month:'long',day:'numeric',year:'numeric'});
      $('pageEyebrow').textContent='YOUR WEEK AT A GLANCE';
      $('pageTitle').textContent=`${a} – ${b}`;
      $('pageCaption').textContent='A clear view of your week, hour by hour.';
      $('panelTitle').textContent='Weekly schedule';
      $('panelDescription').textContent='Select an empty hour to add an item · Select a task to edit';
    } else {
      $('pageEyebrow').textContent='THE BIGGER PICTURE';
      $('pageTitle').textContent=fmtDate(selectedDate,{month:'long',year:'numeric'});
      $('pageCaption').textContent='Every important date, in one place.';
      $('panelTitle').textContent='Monthly calendar';
      $('panelDescription').textContent='Select a day number to open its week';
    }
  }
  function renderSummary() {
    let range;
    if (view==='week') { const start=weekStartDate(selectedDate); const end=addDays(start,6); range=tasks.filter(t=>t.date>=dateKey(start)&&t.date<=dateKey(end)); }
    else range=tasks.filter(t=>t.date.slice(0,7)===dateKey(selectedDate).slice(0,7));
    const done=range.filter(isComplete).length;
    const important=range.filter(t=>t.priority==='high'&&!t.completed).length;
    const next=tasks.filter(t=>!t.completed && taskStartStamp(t)>=Date.now()).sort(taskComparator)[0];
    $('dashboard').innerHTML=`
      <div class="dash-tile"><div class="dash-label">${view==='week'?'This week':'This month'} · planned</div><div class="dash-value">${range.length} <small>scheduled items</small></div></div>
      <div class="dash-tile"><div class="dash-label">Tasks completed</div><div class="dash-value">${done} <small>of ${range.length}</small></div></div>
      <div class="dash-tile"><div class="dash-label">High priority</div><div class="dash-value">${important} <small>remaining</small></div></div>`;
    $('progressPercent').textContent=range.length?`${Math.round(done/range.length*100)}%`:'0%';
    $('progressFill').style.width=range.length?`${Math.round(done/range.length*100)}%`:'0%';
    $('progressNote').textContent=range.length?`${done} of ${range.length} items completed. ${important?important+' high-priority item'+(important===1?'':'s')+' to focus on.':'You are on track.'}`:'Your calendar is ready for your next plan.';
    $('progressRange').textContent=view==='week'?'This week':'This month';
  }
  function renderMini() {
    $('miniTitle').textContent=fmtDate(miniMonth,{month:'long',year:'numeric'});
    const weekNames=Number(settings.weekStart)===1?['M','T','W','T','F','S','S']:['S','M','T','W','T','F','S'];
    const first=new Date(miniMonth.getFullYear(),miniMonth.getMonth(),1);
    const firstShown=weekStartDate(first);
    const html=weekNames.map(n=>`<div class="mini-day-name">${n}</div>`);
    for(let i=0;i<42;i++){
      const d=addDays(firstShown,i),k=dateKey(d);
      const has=tasks.some(t=>t.date===k);
      const classes=['mini-date',d.getMonth()!==miniMonth.getMonth()?'outside':'',isToday(d)?'today':'',k===dateKey(selectedDate)?'selected':'',has?'has-task':''].join(' ');
      html.push(`<button type="button" class="${classes}" data-go-date="${k}" title="${escapeHTML(fmtDate(d,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}" aria-label="Open ${k}">${d.getDate()}</button>`);
    }
    $('miniGrid').innerHTML=html.join('');
  }
  function renderSidebar() {
    const future=tasks.filter(t=>t.kind==='reminder'&&!t.completed && taskStartStamp(t)>=Date.now()-3600000).sort(taskComparator).slice(0,4);
    $('upcomingReminders').innerHTML=future.length?future.map(t=>`
      <button type="button" class="reminder-item" data-edit="${escapeHTML(t.id)}">
        <span class="reminder-bar" aria-hidden="true"></span>
        <span><span class="reminder-name">${escapeHTML(t.title)}</span><span class="reminder-when" style="display:block">${escapeHTML(taskWhen(t))}</span></span>
      </button>`).join(''):'<p class="side-note">Nothing upcoming. Add an important reminder to see it here.</p>';
  }
  function renderCalendar() {
    const viewport=$('weekViewport');
    const previousScroll=view==='week' && viewport && !scrollToWorkHours ? {top:viewport.scrollTop,left:viewport.scrollLeft}:null;
    if (view==='week') renderWeek(); else renderMonth();
    const current=$('weekViewport');
    if(current){
      if(previousScroll){current.scrollTop=previousScroll.top;current.scrollLeft=previousScroll.left;}
      else current.scrollTop=7*64;
    }
    scrollToWorkHours=false;
  }
  function renderWeek() {
    const first=weekStartDate(selectedDate);
    const days=Array.from({length:7},(_,i)=>addDays(first,i));
    let heads='<div class="week-corner"></div>', allDay='<div class="all-day-label">ALL DAY</div>', columns='';
    for (const d of days) {
      const k=dateKey(d),onDate=tasks.filter(t=>t.date===k),all=onDate.filter(t=>t.allDay).sort(taskComparator),timed=onDate.filter(t=>!t.allDay);
      heads+=`<div class="week-day-header ${isToday(d)?'today':''}"><div class="week-weekday">${fmtDate(d,{weekday:'short'})}</div><span class="week-daynum">${d.getDate()}</span></div>`;
      allDay+=`<div class="all-day-slot">${all.map(t=>`<button class="all-day-event ${taskColorClass(t)} ${t.completed?'done':''}" type="button" data-edit="${escapeHTML(t.id)}" title="${escapeHTML(t.title)}">${t.priority==='high'?'◆ ':''}${escapeHTML(t.title)}</button>`).join('')}</div>`;
      columns+=`<div class="time-day ${isToday(d)?'today':''}" data-create-date="${k}" title="Select to schedule a task">${layoutTimed(timed)}${isToday(d)?`<div class="current-time" style="top:${((today().getHours()*60+today().getMinutes())/60*64).toFixed(2)}px"></div>`:''}</div>`;
    }
    let labels='';
    for(let h=0;h<24;h++) labels+=`<div class="time-marker" style="top:${h*64}px">${escapeHTML(timeLabel(asTime(h*60),true))}</div>`;
    $('calendarContent').innerHTML=`<div class="week-viewport" id="weekViewport"><div class="week-inner"><div class="week-head">${heads}</div><div class="all-day-row">${allDay}</div><div class="time-body"><div class="time-rail">${labels}</div><div class="days-grid">${columns}</div></div></div></div>`;
  }
  function layoutTimed(events) {
    if (!events.length) return '';
    const items=events.map(t=>({...t,from:minutes(t.start),to:minutes(t.end)})).filter(t=>t.to>t.from).sort((a,b)=>a.from-b.from || a.to-b.to);
    const groups=[]; let group=[],lastEnd=-1;
    for(const t of items){
      if(group.length && t.from>=lastEnd){groups.push(group);group=[];lastEnd=-1;}
      group.push(t);lastEnd=Math.max(lastEnd,t.to);
    }
    if(group.length)groups.push(group);
    let html='';
    for(const set of groups){
      const busy=[];
      const placed=set.map(t=>{
        let lane=busy.findIndex(end=>end<=t.from);
        if(lane<0){lane=busy.length;busy.push(t.to);} else busy[lane]=t.to;
        return {t,lane};
      });
      const count=busy.length;
      for(const {t,lane} of placed){
        const top=(t.from/60)*64;
        const height=Math.max(20,((t.to-t.from)/60)*64-2);
        const width=(100/count);
        html+=`<button type="button" class="event ${taskColorClass(t)} ${height<40?'tiny':''} ${t.completed?'done':''} ${t.priority==='high'?'important':''}" data-edit="${escapeHTML(t.id)}" style="top:${top}px;height:${height}px;left:calc(${lane*width}% + 2px);width:calc(${width}% - 4px)" title="${escapeHTML(t.title+' | '+timeLabel(t.start)+'–'+timeLabel(t.end))}"><span class="event-title">${escapeHTML(t.title)}</span><span class="event-time">${escapeHTML(timeLabel(t.start))} – ${escapeHTML(timeLabel(t.end))}</span></button>`;
      }
    }
    return html;
  }
  function renderMonth() {
    const first=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
    const start=weekStartDate(first);
    const lastOfMonth=new Date(first.getFullYear(),first.getMonth()+1,0);
    const calendarDays=Math.round((Date.UTC(lastOfMonth.getFullYear(),lastOfMonth.getMonth(),lastOfMonth.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/86400000)+1;
    const weekCount=Math.ceil(calendarDays/7);
    const names=Number(settings.weekStart)===1?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html=names.map(n=>`<div class="month-weekname">${n}</div>`).join('');
    for(let i=0;i<weekCount*7;i++){
      const d=addDays(start,i),k=dateKey(d),items=tasks.filter(t=>t.date===k).sort(taskComparator);
      html+=`<div class="month-cell ${d.getMonth()!==first.getMonth()?'outside':''} ${isToday(d)?'today':''}"><button type="button" class="month-date" data-go-date="${k}" aria-label="Open week of ${k}">${d.getDate()}</button><div class="month-events">${items.slice(0,3).map(t=>`<button type="button" class="month-event ${taskColorClass(t)} ${t.completed?'done':''}" data-edit="${escapeHTML(t.id)}" title="${escapeHTML(t.title)}">${t.allDay?'':escapeHTML(timeLabel(t.start))+' · '}${escapeHTML(t.title)}</button>`).join('')}${items.length>3?`<button type="button" class="more-events" data-go-date="${k}">+${items.length-3} more</button>`:''}</div></div>`;
    }
    $('calendarContent').innerHTML=`<div class="month-grid">${html}</div>`;
  }

  function setView(next) { if(view!==next){view=next;scrollToWorkHours=true;render();} }
  function goToDate(k,openWeek=true) { if(!validDate(k))return; selectedDate=fromKey(k); miniMonth=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);if(openWeek)view='week';scrollToWorkHours=true;render(); }
  function changePeriod(delta) { selectedDate=view==='week'?addDays(selectedDate,7*delta):addMonths(selectedDate,delta);miniMonth=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);scrollToWorkHours=true;render(); }
  function toggleTimeInputs() { const all=$('taskAllDay').checked; document.querySelectorAll('.time-dependent').forEach(el=>el.hidden=all); $('taskStart').required=!all;$('taskEnd').required=!all; }
  function openTask(id=null, date=dateKey(selectedDate), time='09:00') {
    const item=id ? tasks.find(t=>t.id===id):null;
    editingId=item?.id||null;
    $('taskDialogTitle').textContent=item?'Edit task or reminder':'New task';
    $('saveTask').textContent=item?'Save changes':'Create task';
    $('deleteTask').hidden=!item;
    $('taskForm').reset();
    $('taskTitle').value=item?.title??'';
    $('taskDate').value=item?.date??date;
    $('taskKind').value=item?.kind??'task';
    $('taskPriority').value=item?.priority??'normal';
    $('taskCategory').value=item?.category??'work';
    $('taskAllDay').checked=Boolean(item?.allDay);
    $('taskStart').value=item?.start??time;
    $('taskEnd').value=item?.end??asTime(Math.min(23*60+59, minutes(time)+Number(settings.duration)));
    $('taskReminder').value=item?.reminder??'none';
    $('taskNotes').value=item?.notes??'';
    $('taskCompleted').checked=Boolean(item?.completed);
    toggleTimeInputs();showDialog('taskDialog');$('taskTitle').focus();
  }
  async function saveTask(event) {
    event.preventDefault();
    const title=$('taskTitle').value.trim(),date=$('taskDate').value,allDay=$('taskAllDay').checked;
    const start=$('taskStart').value,end=$('taskEnd').value;
    if(!title || !validDate(date)){notify('Please enter a title and valid date.');return;}
    if(!allDay && (!validTime(start)||!validTime(end)||minutes(end)<=minutes(start))){notify('The end time must be later than the start time on the same day.');return;}
    const old=tasks.find(t=>t.id===editingId);
    const item={id:editingId||randomId(),title,date,kind:$('taskKind').value==='reminder'?'reminder':'task',priority:$('taskPriority').value==='high'?'high':'normal',category:$('taskCategory').value,allDay,start:allDay?'09:00':start,end:allDay?'10:00':end,reminder:$('taskReminder').value,notes:$('taskNotes').value.trim(),completed:$('taskCompleted').checked};
    $('saveTask').disabled = true;
    try {
      await cloudUpsert([item]);
      if(old){tasks=tasks.map(t=>t.id===item.id?item:t);}else tasks.push(item);
      closeDialog('taskDialog');render();notify(old?'Item updated and synced.':'Item added and synced.');
    } catch (err) { notify(`Could not save the task: ${err.message}`); }
    finally { $('saveTask').disabled = false; }
  }
  function openSettings() {
    $('settingWeekStart').value=String(settings.weekStart);
    $('settingTimeFormat').value=String(settings.timeFormat);
    $('settingDuration').value=String(settings.duration);
    $('settingNotifications').checked=Boolean(settings.notifications);
    showDialog('settingsDialog');
  }
  function settingsChanged() {
    settings.weekStart=Number($('settingWeekStart').value);
    settings.timeFormat=Number($('settingTimeFormat').value);
    settings.duration=Number($('settingDuration').value);
    save();render();
  }
  async function notificationsChanged() {
    if(!$('settingNotifications').checked){settings.notifications=false;save();return;}
    if(!('Notification' in window)){notify('This browser does not support desktop notifications.');$('settingNotifications').checked=false;return;}
    try{
      const permission=await Notification.requestPermission();
      if(permission==='granted'){settings.notifications=true;notify('Desktop reminders enabled while Daymark is open.');}
      else {settings.notifications=false;$('settingNotifications').checked=false;notify('Notifications were not allowed by your browser.');}
      save();
    } catch {settings.notifications=false;$('settingNotifications').checked=false;notify('Could not enable notifications here.');}
  }
  function checkReminders() {
    if(!settings.notifications||!('Notification' in window)||Notification.permission!=='granted')return;
    const now=Date.now();
    const fired=safeLoad(NOTIFIED_KEY,{});
    let changed=false;
    for(const t of tasks){
      if(t.completed||t.reminder==='none'||!/^\d+$/.test(String(t.reminder)))continue;
      const alertTime=taskStartStamp(t)-Number(t.reminder)*60_000;
      const key=`${t.id}:${alertTime}`;
      if(!fired[key] && alertTime<=now && alertTime>now-60_000){
        try {new Notification('Daymark reminder',{body:`${t.title} · ${taskWhen(t)}`,tag:`daymark-${t.id}`});fired[key]=now;changed=true;}catch{}
      }
    }
    if(changed){
      const entries=Object.entries(fired).filter(([,time])=>time>now-30*86400000).slice(-200);
      try{localStorage.setItem(NOTIFIED_KEY,JSON.stringify(Object.fromEntries(entries)));}catch{}
    }
  }
  function openSearch() { showDialog('searchDialog');$('searchInput').value='';renderSearch();$('searchInput').focus(); }
  function renderSearch() {
    const q=$('searchInput').value.trim().toLowerCase();
    const matches=tasks.filter(t=>(t.title+' '+t.notes+' '+t.date+' '+t.category).toLowerCase().includes(q)).sort(taskComparator).slice(0,50);
    $('searchResults').innerHTML=matches.length?matches.map(t=>`<button type="button" class="search-item" data-edit="${escapeHTML(t.id)}"><span class="search-marker" style="background:var(--${t.kind==='reminder'?'reminder':t.category})"></span><span><span class="search-item-title">${t.completed?'✓ ':''}${escapeHTML(t.title)}</span><span class="search-item-meta" style="display:block">${escapeHTML(taskWhen(t))} · ${escapeHTML(t.kind==='reminder'?'Reminder':t.category)}</span></span></button>`).join(''):'<p class="side-note">No matching tasks or reminders.</p>';
  }
  function closeTools(){ $('toolsMenu').hidden=true;$('toolsButton').setAttribute('aria-expanded','false'); }
  function downloadFile(content,filename,mime){
    const url=URL.createObjectURL(new Blob([content],{type:mime}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportBackup(){downloadFile(JSON.stringify({app:'Daymark Personal Planner',version:1,exportedAt:new Date().toISOString(),settings,tasks},null,2),`daymark-backup-${dateKey(today())}.json`,'application/json');notify('Backup downloaded.');}
  const icsEscape=(s)=>String(s??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  function exportICS(){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daymark//Personal Planner//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:Daymark'];
    for(const t of tasks){
      const day=t.date.replaceAll('-','');
      lines.push('BEGIN:VEVENT',`UID:${t.id.replace(/[^a-zA-Z0-9-]/g,'')}@daymark.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`);
      if(t.allDay){ const tomorrow=dateKey(addDays(fromKey(t.date),1)).replaceAll('-','');lines.push(`DTSTART;VALUE=DATE:${day}`,`DTEND;VALUE=DATE:${tomorrow}`); }
      else {lines.push(`DTSTART:${day}T${t.start.replace(':','')}00`,`DTEND:${day}T${t.end.replace(':','')}00`);}
      lines.push(`SUMMARY:${icsEscape(t.title)}`,`DESCRIPTION:${icsEscape(t.notes||'')}`,`CATEGORIES:${icsEscape(t.kind==='reminder'?'REMINDER':t.category.toUpperCase())}`,'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    downloadFile(lines.join('\r\n')+'\r\n',`daymark-calendar-${dateKey(today())}.ics`,'text/calendar');notify('Calendar exported (.ics).');
  }
  function normalizeItem(raw) {
    if(!raw || typeof raw!=='object')return null;
    const title=String(raw.title??raw.summary??'').trim().slice(0,160);
    const date=String(raw.date??'');
    if(!title||!validDate(date))return null;
    const allDayValue=raw.allDay??raw.allday??raw.all_day;
    const allDay=allDayValue===true || String(allDayValue).toLowerCase()==='true' || String(allDayValue)==='1';
    const start=validTime(raw.start)?raw.start:'09:00';
    let end=validTime(raw.end)?raw.end:'10:00';
    if(minutes(end)<=minutes(start))end=asTime(Math.min(23*60+59,minutes(start)+60));
    if(!allDay&&minutes(end)<=minutes(start))return null;
    const validCats=['work','study','personal','health'];
    return {id:randomId(),title,date,kind:raw.kind==='reminder'||raw.type==='reminder'?'reminder':'task',priority:raw.priority==='high'?'high':'normal',category:validCats.includes(raw.category)?raw.category:'personal',allDay,start,end,reminder:['none','0','5','15','30','60','1440'].includes(String(raw.reminder))?String(raw.reminder):'none',notes:String(raw.notes??raw.description??'').slice(0,4000),completed:raw.completed===true||String(raw.completed).toLowerCase()==='true'};
  }
  function parseCSV(source) {
    const rows=[];let row=[],field='',inside=false;
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(c==='"'){ if(inside&&source[i+1]==='"'){field+='"';i++;}else inside=!inside;}
      else if(c===','&&!inside){row.push(field);field='';}
      else if((c==='\n'||c==='\r')&&!inside){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}
      else field+=c;
    }
    row.push(field);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)throw new Error('CSV needs a header row and at least one entry.');
    const header=rows.shift().map(h=>h.trim().replace(/^\uFEFF/,'').toLowerCase());
    if(!header.includes('title')||!header.includes('date'))throw new Error('CSV must contain title and date columns.');
    return rows.map(fields=>{
      const obj={};header.forEach((key,i)=>obj[key]=String(fields[i]||'').trim());
      if(obj.time&&!obj.start)obj.start=obj.time;
      if(obj.description&&!obj.notes)obj.notes=obj.description;
      if(obj.type&&!obj.kind)obj.kind=obj.type;
      return normalizeItem(obj);
    }).filter(Boolean);
  }
  function icsUnescape(s){return String(s||'').replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');}
  function icsDateTime(raw){
    if(!raw)return null;
    const match=raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if(!match)return null;
    const [_,y,m,d,h,mi,sec,utc]=match;
    if(h===undefined)return {date:`${y}-${m}-${d}`,allDay:true,time:'09:00'};
    if(utc){const dt=new Date(Date.UTC(+y,+m-1,+d,+h,+mi,+(sec||0)));return {date:dateKey(dt),allDay:false,time:`${pad(dt.getHours())}:${pad(dt.getMinutes())}`};}
    return {date:`${y}-${m}-${d}`,allDay:false,time:`${h}:${mi}`};
  }
  function parseICS(content) {
    const lines=content.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const unfolded=[];
    for(const line of lines){if(/^[ \t]/.test(line)&&unfolded.length)unfolded[unfolded.length-1]+=line.slice(1);else unfolded.push(line);}
    let current=null;const events=[];
    for(const line of unfolded){
      if(line==='BEGIN:VEVENT'){current={};continue;}
      if(line==='END:VEVENT'){if(current)events.push(current);current=null;continue;}
      if(!current)continue;
      const colon=line.indexOf(':');if(colon<0)continue;
      const key=line.slice(0,colon).split(';')[0].toUpperCase(),value=line.slice(colon+1);
      if(['SUMMARY','DESCRIPTION','DTSTART','DTEND','CATEGORIES'].includes(key))current[key]=value;
    }
    return events.map(e=>{
      const start=icsDateTime(e.DTSTART),end=icsDateTime(e.DTEND);
      if(!start)return null;
      let endTime=end?.time||asTime(Math.min(23*60+59,minutes(start.time)+60));
      if(!start.allDay && end && end.date!==start.date){endTime='23:59';}
      return normalizeItem({title:icsUnescape(e.SUMMARY||'Untitled event'),date:start.date,start:start.time,end:endTime,allDay:start.allDay,kind:'reminder',category:'personal',notes:icsUnescape(e.DESCRIPTION||''),priority:'normal'});
    }).filter(Boolean);
  }
  async function importFile(event,restore=false) {
    const file=event.target.files?.[0];if(!file)return;
    try {
      const content=await file.text(),extension=file.name.split('.').pop()?.toLowerCase();
      let imported=[], newSettings=null;
      if(restore){
        const parsed=JSON.parse(content),source=Array.isArray(parsed)?parsed:parsed.tasks;
        if(!Array.isArray(source))throw new Error('Backup must contain a tasks array.');
        imported=source.map(normalizeItem).filter(Boolean);
        if(parsed.settings && typeof parsed.settings==='object')newSettings={...defaultSettings,...parsed.settings,notifications:false};
        if(!confirm(`Replace the ${tasks.length} tasks in your cloud account with ${imported.length} items from this backup?`))return;
        // Upload first, then remove old task IDs. On partial failure we reload from the cloud.
        const previousIds=tasks.map(t=>t.id);
        await cloudUpsert(imported);
        const importedIds=new Set(imported.map(t=>t.id));
        const removedIds=previousIds.filter(id=>!importedIds.has(id));
        if(removedIds.length)await cloudDelete(removedIds);
        if(newSettings){settings=newSettings;save();}
        await reloadCloud();
        notify(`Restored ${imported.length} items to your account.`);
      } else {
        if(extension==='ics')imported=parseICS(content);
        else if(extension==='csv')imported=parseCSV(content);
        else if(extension==='json'){
          const parsed=JSON.parse(content),source=Array.isArray(parsed)?parsed:parsed.tasks;
          if(!Array.isArray(source))throw new Error('JSON must contain a tasks array.');
          imported=source.map(normalizeItem).filter(Boolean);
        } else throw new Error('Choose an .ics, .csv or .json file.');
        if(!imported.length)throw new Error('No valid items found. Check dates and titles.');
        await cloudUpsert(imported);
        await reloadCloud();
        notify(`Imported ${imported.length} items to your account.`);
      }
    } catch(error){try{await reloadCloud();}catch{}notify(`Import failed or incomplete: ${error.message}`);}
    finally{event.target.value='';}
  }

  // Delegated clicks keep newly rendered calendar tasks interactive.
  document.addEventListener('click',(e)=>{
    const edit=e.target.closest('[data-edit]');
    if(edit){closeDialog('searchDialog');openTask(edit.dataset.edit);return;}
    const go=e.target.closest('[data-go-date]');
    if(go){goToDate(go.dataset.goDate);return;}
    const create=e.target.closest('.time-day[data-create-date]');
    if(create){const y=e.clientY-create.getBoundingClientRect().top;const slot=Math.max(0,Math.min(23*60,Math.floor(y/32)*30));openTask(null,create.dataset.createDate,asTime(slot));return;}
    const close=e.target.closest('[data-close]');
    if(close){closeDialog(close.dataset.close);return;}
    if(!e.target.closest('#toolsRoot'))closeTools();
  });
  $('taskForm').addEventListener('submit',saveTask);
  $('taskAllDay').addEventListener('change',toggleTimeInputs);
  $('taskKind').addEventListener('change',()=>{if($('taskKind').value==='reminder'&&$('taskReminder').value==='none')$('taskReminder').value='15';});
  $('deleteTask').addEventListener('click',async()=>{
    if(!editingId)return;
    if(!confirm('Delete this task or reminder?'))return;
    $('deleteTask').disabled=true;
    try { await cloudDelete([editingId]);tasks=tasks.filter(t=>t.id!==editingId);closeDialog('taskDialog');render();notify('Item deleted.'); }
    catch(err){notify(`Could not delete: ${err.message}`);}
    finally{$('deleteTask').disabled=false;}
  });
  $('newTaskTop').addEventListener('click',()=>openTask(null,dateKey(selectedDate)));
  $('weekButton').addEventListener('click',()=>setView('week'));
  $('monthButton').addEventListener('click',()=>setView('month'));
  $('prevButton').addEventListener('click',()=>changePeriod(-1));
  $('nextButton').addEventListener('click',()=>changePeriod(1));
  $('todayButton').addEventListener('click',()=>goToDate(dateKey(today()),false));
  $('miniPrev').addEventListener('click',()=>{miniMonth=addMonths(miniMonth,-1);renderMini();});
  $('miniNext').addEventListener('click',()=>{miniMonth=addMonths(miniMonth,1);renderMini();});
  $('sidebarToggle').addEventListener('click',()=>{$('sidebar').classList.toggle('open');});
  $('searchOpen').addEventListener('click',openSearch);
  $('searchInput').addEventListener('input',renderSearch);
  $('settingsOpen').addEventListener('click',openSettings);
  ['settingWeekStart','settingTimeFormat','settingDuration'].forEach(id=>$(id).addEventListener('change',settingsChanged));
  $('settingNotifications').addEventListener('change',notificationsChanged);
  $('clearDataButton').addEventListener('click',async()=>{
    if(!confirm(`Permanently delete all ${tasks.length} tasks and reminders from your account on every device? Download a backup first.`))return;
    $('clearDataButton').disabled=true;
    try {
      const {error}=await client.from('daymark_tasks').delete().eq('user_id',userId);
      if(error)throw new Error(error.message);
      tasks=[];closeDialog('settingsDialog');render();notify('All account tasks deleted.');
    } catch(err){notify(`Could not clear your planner: ${err.message}`);}
    finally{$('clearDataButton').disabled=false;}
  });
  $('migrateLocalButton').addEventListener('click',async()=>{
    const legacy=safeLoad(STORE_KEY,[]);
    if(!Array.isArray(legacy)||!legacy.length){notify('No older locally saved tasks were found on this browser.');return;}
    if(!confirm(`Import ${legacy.length} locally saved tasks into this account? This is optional and does not remove the originals.`))return;
    const imported=legacy.map(normalizeItem).filter(Boolean);
    try {await cloudUpsert(imported); await reloadCloud();notify(`Imported ${imported.length} previous tasks into your account.`);closeDialog('settingsDialog');}
    catch(err){try{await reloadCloud();}catch{}notify(`Import incomplete: ${err.message}`);}
  });
  $('logOutButton').addEventListener('click',async()=>{
    $('logOutButton').disabled=true;
    const {error}=await client.auth.signOut();
    if(error){$('logOutButton').disabled=false;notify(`Could not log out: ${error.message}`);return;}
    location.replace('login.html');
  });
  $('toolsButton').addEventListener('click',()=>{const next=$('toolsMenu').hidden;$('toolsMenu').hidden=!next;$('toolsButton').setAttribute('aria-expanded',String(next));});
  $('importButton').addEventListener('click',()=>{closeTools();$('importInput').click();});
  $('restoreBackupButton').addEventListener('click',()=>{closeTools();$('restoreInput').click();});
  $('exportBackupButton').addEventListener('click',()=>{closeTools();exportBackup();});
  $('exportIcsButton').addEventListener('click',()=>{closeTools();exportICS();});
  $('importInput').addEventListener('change',(e)=>importFile(e,false));
  $('restoreInput').addEventListener('change',(e)=>importFile(e,true));
  document.addEventListener('keydown',(e)=>{
    const typing=e.target.matches('input,textarea,select,[contenteditable="true"]');
    if(!typing && !document.querySelector('dialog[open]')){
      if(e.key==='n'||e.key==='N'){e.preventDefault();openTask(null,dateKey(selectedDate));}
      if(e.key==='/'){e.preventDefault();openSearch();}
    }
    if(e.key==='Escape')closeTools();
  });
  setInterval(checkReminders,30000);
  setInterval(()=>{if(view==='week'){const line=document.querySelector('.current-time');if(line)line.style.top=`${((today().getHours()*60+today().getMinutes())/60*64).toFixed(2)}px`; }},60000);
  $('accountEmail').textContent = user.email || 'Signed in';
  const bootScreen = $('bootScreen');
  $('plannerApp').hidden = false;
  bootScreen.hidden = true;
  render();
})();
