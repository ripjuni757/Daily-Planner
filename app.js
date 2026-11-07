'use strict';
(async () => {
  const boot = document.getElementById('bootScreen');
  const client = window.daymarkClient;
  if (!client) {
    boot.innerHTML = 'Solenary needs Supabase configuration. Open <strong>supabase-config.js</strong> and follow the setup steps in README.md.';
    return;
  }
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) {
    location.replace('login.html');
    return;
  }
  const user = authData.user;
  const userId = user.id;

  const META_ID = '__daymark_compass_meta_v1__';
  const defaultCompass = {version:1,focus:{},priorityIds:{},projects:[],reviews:{},workStart:'08:00',workEnd:'21:00',bufferMinutes:45,weeklyCommitments:[]};
  let compass = {...defaultCompass};
  const STORE_KEY = 'daymark.planner.tasks.v1';
  const SETTINGS_KEY = `daymark.planner.settings.v2.${userId}`;
  const NOTIFIED_KEY = `daymark.planner.notified.v2.${userId}`;
  const defaultSettings = { weekStart: 1, timeFormat: 12, duration: 60, notifications: false };
  const $ = (id) => document.getElementById(id);
  const schoolProfile = {
    school:user.user_metadata?.solenary_school==='cannon'?'cannon':null,
    division:['middle','upper'].includes(user.user_metadata?.solenary_school_division)
      ?user.user_metadata.solenary_school_division:null
  };
  function updateCannonLink(){
    $('cannonUsNav').hidden=!(schoolProfile.school==='cannon' && schoolProfile.division==='upper');
  }
  updateCannonLink();
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
  // Planner goals and reflections are stored under a reserved ID in the existing,
  // user-protected daymark_tasks table. No new SQL migration is needed.
  try {
    const {data,error}=await client.from('daymark_tasks').select('task')
      .eq('user_id',userId).eq('task_id',META_ID).maybeSingle();
    if(error) throw new Error(error.message);
    if(data?.task && data.task.version===1) {
      const value=data.task;
      compass={...defaultCompass,...value,
        focus: value.focus&&typeof value.focus==='object'?value.focus:{},
        priorityIds:value.priorityIds&&typeof value.priorityIds==='object'?value.priorityIds:{},
        projects:Array.isArray(value.projects)?value.projects:[],
        reviews:value.reviews&&typeof value.reviews==='object'?value.reviews:{},
        weeklyCommitments:Array.isArray(value.weeklyCommitments)?value.weeklyCommitments.filter(w=>w&&typeof w==='object'):[]};
    }
  }catch(error){
    boot.textContent=`Could not load your planning goals: ${error.message}. Refresh or check your Supabase settings.`;
    return;
  }
  let selectedDate = today();
  let miniMonth = new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
  let view = 'week';
  let editingId = null;
  let repeatOffsets = new Set([0,1,2,3]);
  let editingSeries = null;
  let toastTimer;
  let scrollToWorkHours = true;
  const isToday = (d) => dateKey(d)===dateKey(today());
  const isComplete = (t) => Boolean(t.completed);
  // Color represents the KIND of calendar item, not its category.
  // The category (work/study/personal/health) is still preserved in the task data.
  const taskColorClass = (t) => (t.seriesId || t.recurring === true)
    ? 'cat-weekly'
    : t.kind === 'reminder' ? 'cat-reminder' : 'cat-task';
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
    // v11: a durable cloud write has finished. The integration decides whether
    // Google writeback is enabled and debounces multiple saves into one sync.
    if (items.length) window.dispatchEvent(new CustomEvent('solenary:tasks-changed',
      {detail:{action:'upsert',count:items.length}}));
  }
  async function cloudDelete(ids) {
    for (let i = 0; i < ids.length; i += 150) {
      const { error } = await client.from('daymark_tasks').delete()
        .eq('user_id', userId).in('task_id', ids.slice(i,i+150));
      if (error) throw new Error(error.message);
    }
    if (ids.length) window.dispatchEvent(new CustomEvent('solenary:tasks-changed',
      {detail:{action:'delete',count:ids.length}}));
  }
  async function reloadCloud() {
    tasks = await fetchCloudTasks();
    render();
  }
  // Google Calendar's server-side sync may add or update user-scoped tasks.
  // Refresh the UI after those database changes without losing current view.
  window.addEventListener('solenary:calendar-synced', () => {
    reloadCloud().catch(error => notify(`Could not refresh synced tasks: ${error.message}`));
  });
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
  const taskWhen = (t) => `${fmtDate(fromKey(t.date),{month:'short',day:'numeric',year:'numeric'})}${t.allDay?' · All day':' · '+timeLabel(t.start)+'–'+timeLabel(t.end)}${t.location?' · '+t.location:''}`;

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
      const dayKinds=[...new Set(tasks.filter(t=>t.date===k).map(taskColorClass))];
      const classes=['mini-date',d.getMonth()!==miniMonth.getMonth()?'outside':'',isToday(d)?'today':'',k===dateKey(selectedDate)?'selected':'',dayKinds.length?'has-task':''].join(' ');
      const markers=dayKinds.length?`<span class="mini-dots" aria-hidden="true">${dayKinds.map(kind=>`<span class="mini-dot ${kind}"></span>`).join('')}</span>`:'';
      html.push(`<button type="button" class="${classes}" data-go-date="${k}" title="${escapeHTML(fmtDate(d,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}" aria-label="Open ${k}">${d.getDate()}${markers}</button>`);
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
      columns+=`<div class="time-day ${isToday(d)?'today':''}" data-create-date="${k}" title="Select to schedule a task">${layoutWeeklyCommitments(k)}${layoutTimed(timed)}${isToday(d)?`<div class="current-time" style="top:${((today().getHours()*60+today().getMinutes())/60*64).toFixed(2)}px"></div>`:''}</div>`;
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
        html+=`<button type="button" class="event ${taskColorClass(t)} ${height<40?'tiny':''} ${t.completed?'done':''} ${t.priority==='high'?'important':''}" data-edit="${escapeHTML(t.id)}" style="top:${top}px;height:${height}px;left:calc(${lane*width}% + 2px);width:calc(${width}% - 4px)" title="${escapeHTML(t.title+' | '+timeLabel(t.start)+'–'+timeLabel(t.end)+(t.location?' | '+t.location:''))}"><span class="event-title">${escapeHTML(t.title)}</span><span class="event-time">${escapeHTML(timeLabel(t.start))} – ${escapeHTML(timeLabel(t.end))}</span>${t.location&&height>=98?`<span class="event-location">${escapeHTML(t.location)}</span>`:''}</button>`;
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
      html+=`<div class="month-cell ${d.getMonth()!==first.getMonth()?'outside':''} ${isToday(d)?'today':''}"><button type="button" class="month-date" data-go-date="${k}" aria-label="Open week of ${k}">${d.getDate()}</button><div class="month-events">${items.slice(0,3).map(t=>`<button type="button" class="month-event ${taskColorClass(t)} ${t.completed?'done':''}" data-edit="${escapeHTML(t.id)}" title="${escapeHTML(t.title+(t.location?' · '+t.location:''))}">${t.allDay?'':escapeHTML(timeLabel(t.start))+' · '}${escapeHTML(t.title)}</button>`).join('')}${items.length>3?`<button type="button" class="more-events" data-go-date="${k}">+${items.length-3} more</button>`:''}</div></div>`;
    }
    $('calendarContent').innerHTML=`<div class="month-grid">${html}</div>`;
  }

  function setView(next) { if(view!==next){view=next;scrollToWorkHours=true;render();} }
  function goToDate(k,openWeek=true) { if(!validDate(k))return; selectedDate=fromKey(k); miniMonth=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);if(openWeek)view='week';scrollToWorkHours=true;render(); }
  function changePeriod(delta) { selectedDate=view==='week'?addDays(selectedDate,7*delta):addMonths(selectedDate,delta);miniMonth=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);scrollToWorkHours=true;render(); }
  // WEEKLY RECURRENCE: materialize only the weeks chosen by the user into
  // individually identifiable task rows. This preserves privacy under the
  // existing daymark_tasks user-scoped RLS policies, and completion is per week.
  const DAYS_IN_WEEK=7;
  const dayDistance=(left,right)=>Math.round((Date.UTC(fromKey(right).getFullYear(),fromKey(right).getMonth(),fromKey(right).getDate())-Date.UTC(fromKey(left).getFullYear(),fromKey(left).getMonth(),fromKey(left).getDate()))/86400000);
  const seriesItems=id=>tasks.filter(t=>t.seriesId===id).sort((a,b)=>a.date.localeCompare(b.date));
  function toggleTimeInputs() {
    const weekly=$('taskKind').value==='weekly';
    if(weekly){$('taskAllDay').checked=false;$('taskAllDay').disabled=true;$('taskFixed').checked=true;$('taskFixed').disabled=true;}else {$('taskAllDay').disabled=false;$('taskFixed').disabled=false;}
    const all=$('taskAllDay').checked;
    document.querySelectorAll('.time-dependent').forEach(el=>el.hidden=all);
    $('taskStart').required=!all;$('taskEnd').required=!all;
    updateDurationLabel();
  }
  function updateDurationLabel() {
    const start=$('taskStart').value,end=$('taskEnd').value;
    const dur=validTime(start)&&validTime(end)?minutes(end)-minutes(start):0;
    const sentence=$('taskAllDay').checked?'All-day item; no duration is required.':(dur>0?`Calculated duration: ${fmtDuration(dur)}.`:'End time must be after start time.');
    $('taskDurationNote').textContent=sentence;
    $('repeatDurationLabel').textContent=sentence;
  }
  function renderRepeatWeeks(){
    const weekly=$('taskKind').value==='weekly';
    const editingAll=(!editingSeries || $('taskEditSeries').checked);
    $('taskRepeatOptions').hidden=!weekly;
    $('taskSeriesEditRow').hidden=!editingSeries;
    $('deleteSeries').hidden=!editingSeries;
    $('taskRepeatWeeks').hidden=!editingAll;
    $('taskRepeatHorizon').disabled=!editingAll;
    $('repeatSelectAll').disabled=!editingAll;
    $('repeatClear').disabled=!editingAll;
    if(!weekly)return;
    const anchor=$('taskDate').value;
    if(!validDate(anchor))return;
    const count=Number($('taskRepeatHorizon').value);
    $('taskRepeatWeeks').innerHTML=Array.from({length:count},(_,i)=>{
      const date=dateKey(addDays(fromKey(anchor),i*DAYS_IN_WEEK));
      const label=fmtDate(fromKey(date),{weekday:'short',month:'short',day:'numeric',year:'numeric'});
      return `<label class="repeat-week-choice"><input type="checkbox" data-week-index="${i}" ${repeatOffsets.has(i)?'checked':''}><span>Week ${i+1}</span><strong>${escapeHTML(label)}</strong></label>`;
    }).join('');
    updateDurationLabel();
  }
  function openTask(id=null, date=dateKey(selectedDate), time='09:00') {
    const item=id ? tasks.find(t=>t.id===id):null;
    editingId=item?.id||null;
    editingSeries=item?.seriesId||null;
    const series=editingSeries?seriesItems(editingSeries):[];
    const anchor=series.length?series[0].date:item?.date??date;
    repeatOffsets=new Set(series.length?series.map(t=>dayDistance(anchor,t.date)/7).filter(x=>Number.isInteger(x)&&x>=0&&x<52):[0,1,2,3]);
    const maxOffset=Math.max(0,...repeatOffsets);
    $('taskRepeatHorizon').value=String(maxOffset<8?8:maxOffset<16?16:maxOffset<26?26:52);
    $('taskEditSeries').checked=true;
    $('taskDialogTitle').textContent=item?'Edit task or reminder':'New task';
    $('saveTask').textContent=item?'Save changes':'Create task';
    $('deleteTask').hidden=!item;
    $('taskForm').reset();
    // reset() restores markup defaults; reapply recurrence state afterwards.
    $('taskRepeatHorizon').value=String(maxOffset<8?8:maxOffset<16?16:maxOffset<26?26:52);
    $('taskEditSeries').checked=true;
    $('taskTitle').value=item?.title??'';
    $('taskDate').value=anchor;
    $('taskKind').value=item?.seriesId?'weekly':item?.kind??'task';
    $('taskPriority').value=item?.priority??'normal';
    $('taskCategory').value=item?.category??'work';
    $('taskAllDay').checked=Boolean(item?.allDay);
    $('taskStart').value=item?.start??time;
    $('taskEnd').value=item?.end??asTime(Math.min(23*60+59,minutes(time)+Number(settings.duration)));
    $('taskLocation').value=item?.location??'';
    $('taskReminder').value=item?.reminder??'none';
    $('taskNotes').value=item?.notes??'';
    $('taskResource').value=item?.resourceUrl??'';
    $('taskResourceOpen').hidden=!item?.resourceUrl;
    $('taskCompleted').checked=Boolean(item?.completed);
    $('taskFixed').checked=Boolean(item?.fixed);
    $('taskActual').value=item?.actualMinutes || '';
    toggleTimeInputs();renderRepeatWeeks();showDialog('taskDialog');$('taskTitle').focus();
  }
  const validResourceUrl = (s) => { try { const u = new URL(String(s||'').trim());return u.protocol==='https:' && u.username==='' && u.password==='' && u.href.length<=1200 ? u.href : ''; } catch{return '';} };
  async function saveTask(event) {
    event.preventDefault();
    const title=$('taskTitle').value.trim(),date=$('taskDate').value,allDay=$('taskAllDay').checked;
    const start=$('taskStart').value,end=$('taskEnd').value,weekly=$('taskKind').value==='weekly';
    if(!title || !validDate(date)){notify('Please enter a title and valid date.');return;}
    if($('taskResource').value.trim() && !validResourceUrl($('taskResource').value)){notify('Related document links must be valid HTTPS links.');return;}
    if(!allDay && (!validTime(start)||!validTime(end)||minutes(end)<=minutes(start))){notify('The end time must be later than the start time on the same day.');return;}
    if(weekly&&!editingSeries&&!repeatOffsets.size){notify('Select at least one week for the recurring activity.');return;}
    if(weekly&&editingSeries&&$('taskEditSeries').checked&&!repeatOffsets.size){notify('Select at least one week, or use Delete series.');return;}
    const old=tasks.find(t=>t.id===editingId);
    const finished=$('taskCompleted').checked;
    const item={...old,id:editingId||randomId(),title,date,kind:$('taskKind').value==='reminder'?'reminder':'task',priority:$('taskPriority').value==='high'?'high':'normal',category:$('taskCategory').value,allDay,start:allDay?'09:00':start,end:allDay?'10:00':end,location:$('taskLocation').value.trim().slice(0,200),reminder:$('taskReminder').value,notes:$('taskNotes').value.trim(),resourceUrl:validResourceUrl($('taskResource').value),completed:finished,fixed:weekly||$('taskFixed').checked,
      estimateMinutes:allDay?0:minutes(end)-minutes(start),actualMinutes:$('taskActual').value?clamp($('taskActual').value,1,1440):null,
      completedAt:finished?(old?.completedAt||new Date().toISOString()):null};
    $('saveTask').disabled = true;
    try {
      if(weekly&&(!editingSeries||$('taskEditSeries').checked)){
        const seriesId=editingSeries||randomId();
        const existing=editingSeries?seriesItems(seriesId):(old?[old]:[]);
        const priorByDate=new Map(existing.map(x=>[x.date,x]));
        const desiredDates=[...repeatOffsets].sort((a,b)=>a-b).map(i=>dateKey(addDays(fromKey(date),i*DAYS_IN_WEEK)));
        if(desiredDates.some(d=>!validDate(d)))throw new Error('Invalid week selection');
        const desired=desiredDates.map(d=>{
          const prior=priorByDate.get(d);
          return {...item,id:prior?.id||randomId(),seriesId,date:d,recurring:true,fixed:true,
            completed:prior?.completed??false,completedAt:prior?.completedAt??null,
            actualMinutes:prior?.actualMinutes??null,deferredCount:prior?.deferredCount??0};
        });
        await cloudUpsert(desired);
        const desiredIds=new Set(desired.map(x=>x.id));
        const removed=existing.filter(x=>!desiredIds.has(x.id)).map(x=>x.id);
        if(removed.length)await cloudDelete(removed);
        await reloadCloud();
        notify(`${desired.length} weekly occurrence${desired.length===1?'':'s'} saved and synced.`);
      }else{
        // Editing one instance of a series leaves the other weeks intact.
        if(!weekly){delete item.seriesId;delete item.recurring;}
        else if(editingSeries){if(item.date===old.date){item.seriesId=editingSeries;item.recurring=true;}else{delete item.seriesId;delete item.recurring;}}
        await cloudUpsert([item]);
        if(old)tasks=tasks.map(t=>t.id===item.id?item:t);else tasks.push(item);
        render();notify(old?'Item updated and synced.':'Item added and synced.');
      }
      closeDialog('taskDialog');
    } catch(err) {
      await reloadCloud().catch(()=>{});
      notify(`Could not save completely: ${err.message}. Check your calendar before retrying.`);
    }finally{$('saveTask').disabled=false;}
  }
  function openSettings() {
    $('settingWeekStart').value=String(settings.weekStart);
    $('settingTimeFormat').value=String(settings.timeFormat);
    $('settingDuration').value=String(settings.duration);
    $('settingNotifications').checked=Boolean(settings.notifications);
    $('settingWorkStart').value=compass.workStart;
    $('settingWorkEnd').value=compass.workEnd;
    $('settingBuffer').value=String(compass.bufferMinutes);
    $('settingCannonStudent').checked=schoolProfile.school==='cannon';
    $('settingCannonDivision').value=schoolProfile.division||'';
    $('settingCannonDivisionGroup').hidden=!$('settingCannonStudent').checked;
    $('schoolSettingStatus').textContent='School selection is self-reported; it does not verify school enrollment.';
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
      if(permission==='granted'){settings.notifications=true;notify('Desktop reminders enabled while Solenary is open.');}
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
        try {new Notification('Solenary reminder',{body:`${t.title} · ${taskWhen(t)}`,tag:`daymark-${t.id}`});fired[key]=now;changed=true;}catch{}
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
    const matches=tasks.filter(t=>(t.title+' '+t.notes+' '+t.date+' '+t.category+' '+(t.location||'')).toLowerCase().includes(q)).sort(taskComparator).slice(0,50);
    $('searchResults').innerHTML=matches.length?matches.map(t=>`<button type="button" class="search-item" data-edit="${escapeHTML(t.id)}"><span class="search-marker ${taskColorClass(t)}"></span><span><span class="search-item-title">${t.completed?'✓ ':''}${escapeHTML(t.title)}</span><span class="search-item-meta" style="display:block">${escapeHTML(taskWhen(t))} · ${escapeHTML(t.kind==='reminder'?'Reminder':t.seriesId?'Weekly activity':t.category)}${t.location?' · '+escapeHTML(t.location):''}</span></span></button>`).join(''):'<p class="side-note">No matching tasks or reminders.</p>';
  }
  function closeTools(){} // The former Tools dropdown was removed; controls now live in Settings and Integrations.
  function downloadFile(content,filename,mime){
    const url=URL.createObjectURL(new Blob([content],{type:mime}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportBackup(){downloadFile(JSON.stringify({app:'Solenary Personal Planner',version:1,exportedAt:new Date().toISOString(),settings,tasks,compass},null,2),`solenary-backup-${dateKey(today())}.json`,'application/json');notify('Backup downloaded.');}
  const icsEscape=(s)=>String(s??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  function exportICS(){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Solenary//Personal Planner//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:Solenary'];
    for(const t of tasks){
      const day=t.date.replaceAll('-','');
      lines.push('BEGIN:VEVENT',`UID:${t.id.replace(/[^a-zA-Z0-9-]/g,'')}@daymark.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`);
      if(t.allDay){ const tomorrow=dateKey(addDays(fromKey(t.date),1)).replaceAll('-','');lines.push(`DTSTART;VALUE=DATE:${day}`,`DTEND;VALUE=DATE:${tomorrow}`); }
      else {lines.push(`DTSTART:${day}T${t.start.replace(':','')}00`,`DTEND:${day}T${t.end.replace(':','')}00`);}
      lines.push(`SUMMARY:${icsEscape(t.title)}`,`DESCRIPTION:${icsEscape(t.notes||'')}`,...(t.location?[`LOCATION:${icsEscape(t.location)}`]:[]),`CATEGORIES:${icsEscape(t.kind==='reminder'?'REMINDER':t.category.toUpperCase())}`,'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    downloadFile(lines.join('\r\n')+'\r\n',`solenary-calendar-${dateKey(today())}.ics`,'text/calendar');notify('Calendar exported (.ics).');
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
    return {id:(typeof raw.id==='string'&&raw.id!==META_ID&&/^[a-zA-Z0-9_:-]{8,100}$/.test(raw.id))?raw.id:randomId(),title,date,kind:raw.kind==='reminder'||raw.type==='reminder'?'reminder':'task',priority:raw.priority==='high'?'high':'normal',category:validCats.includes(raw.category)?raw.category:'personal',allDay,start,end,reminder:['none','0','5','15','30','60','1440'].includes(String(raw.reminder))?String(raw.reminder):'none',notes:String(raw.notes??raw.description??'').slice(0,4000),resourceUrl:validResourceUrl(raw.resourceUrl),location:String(raw.location??'').slice(0,200),seriesId:(typeof raw.seriesId==='string'&&/^[a-zA-Z0-9_:-]{8,100}$/.test(raw.seriesId))?raw.seriesId:null,recurring:raw.recurring===true,completed:raw.completed===true||String(raw.completed).toLowerCase()==='true',
      fixed:raw.fixed===true,estimateMinutes:allDay?0:minutes(end)-minutes(start),
      actualMinutes:raw.actualMinutes?clamp(raw.actualMinutes,1,1440):null,
      projectId:typeof raw.projectId==='string'?raw.projectId:null,
      deferredCount:clamp(raw.deferredCount,0,500),completedAt:typeof raw.completedAt==='string'?raw.completedAt:null};
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
      if(['SUMMARY','DESCRIPTION','DTSTART','DTEND','CATEGORIES','LOCATION'].includes(key))current[key]=value;
    }
    return events.map(e=>{
      const start=icsDateTime(e.DTSTART),end=icsDateTime(e.DTEND);
      if(!start)return null;
      let endTime=end?.time||asTime(Math.min(23*60+59,minutes(start.time)+60));
      if(!start.allDay && end && end.date!==start.date){endTime='23:59';}
      return normalizeItem({title:icsUnescape(e.SUMMARY||'Untitled event'),date:start.date,start:start.time,end:endTime,allDay:start.allDay,kind:'reminder',category:'personal',notes:icsUnescape(e.DESCRIPTION||''),location:icsUnescape(e.LOCATION||''),priority:'normal'});
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
        if(parsed.compass && parsed.compass.version===1){await persistCompass({...defaultCompass,...parsed.compass});}
        else {await persistCompass({...defaultCompass});}
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

  // SOLENARY COMPASS: private, user-scoped planning metadata is stored in daymark_tasks.
  // It shares the exact same RLS policy as ordinary calendar items.
  const clamp = (n,min,max) => Math.max(min,Math.min(max,Number(n)||0));
  const fmtDuration = (m) => `${Math.floor(m/60)}h ${pad(m%60)}m`;
  const periodKey = (date) => dateKey(weekStartDate(date));
  const projectById = (id) => (compass.projects||[]).find(p=>p.id===id);
  const scheduledMinutes = (t) => t.allDay ? 0 : Math.max(0,minutes(t.end)-minutes(t.start));
  function dayTasks(key) { return tasks.filter(t=>t.date===key); }
  function spanOverlap(a,b) {return Math.max(a[0],b[0]) < Math.min(a[1],b[1]);}
  function mergeSpanLength(intervals) {
    let count=0,end=-1;
    for(const [a,b] of intervals.sort((p,q)=>p[0]-q[0])){
      if(a>=end){count+=b-a;end=b;} else if(b>end){count+=b-end;end=b;}
    }
    return count;
  }
  // Weekly commitments are a reusable day-of-week template, not separate tasks.
  // Clip to the planning window only when calculating usable time.
  const weekDays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const activeWeeklyBlocks=()=>Array.isArray(compass.weeklyCommitments)?compass.weeklyCommitments:[];
  function weeklyIntervalsForDate(key){
    const dow=fromKey(key).getDay();
    return activeWeeklyBlocks().filter(b=>Array.isArray(b.days)&&b.days.includes(dow)&&validTime(b.start)&&validTime(b.end)&&minutes(b.end)>minutes(b.start));
  }
  function layoutWeeklyCommitments(key){
    return weeklyIntervalsForDate(key).map(b=>{
      const top=minutes(b.start)/60*64,height=(minutes(b.end)-minutes(b.start))/60*64;
      return `<div class="weekly-calendar-block" style="top:${top}px;height:${height}px" title="${escapeHTML(b.name+' · '+timeLabel(b.start)+'–'+timeLabel(b.end))}"><span>${escapeHTML(b.name)}</span><small>${escapeHTML(timeLabel(b.start))} – ${escapeHTML(timeLabel(b.end))}</small></div>`;
    }).join('');
  }
  function weeklySpans(key){return weeklyIntervalsForDate(key).map(b=>[minutes(b.start),minutes(b.end)]);}
  function dayCapacity(key) {
    const left=minutes(compass.workStart),right=minutes(compass.workEnd);
    const fixed=dayTasks(key).filter(t=>!t.completed && (t.fixed || t.kind==='reminder'));
    const schoolSpans=weeklySpans(key).map(([a,b])=>[Math.max(left,a),Math.min(right,b)]).filter(([a,b])=>b>a);
    const spans=fixed.map(t=>t.allDay ? [left,right] : [Math.max(left,minutes(t.start)),Math.min(right,minutes(t.end))]).filter(([a,b])=>b>a).concat(schoolSpans);
    const blocked=mergeSpanLength(spans);
    const budget=Math.max(0,right-left-blocked-clamp(compass.bufferMinutes,0,240));
    const flexible=dayTasks(key).filter(t=>!t.completed && t.kind==='task' && !t.fixed);
    const planned=flexible.reduce((sum,t)=>sum+scheduledMinutes(t),0);
    const timed=dayTasks(key).filter(t=>!t.allDay && !t.completed).sort((a,b)=>minutes(a.start)-minutes(b.start));
    let collisions=0;
    for(let i=0;i<timed.length;i++)for(let j=i+1;j<timed.length;j++){
      if(spanOverlap([minutes(timed[i].start),minutes(timed[i].end)],[minutes(timed[j].start),minutes(timed[j].end)]))collisions++;
    }
    return {budget,planned,blocked,schoolBlocked:mergeSpanLength(schoolSpans),collisions,remaining:budget-planned};
  }
  function focusPriorityIds(key) {
    const ids=compass.priorityIds?.[key];
    const available=dayTasks(key).filter(t=>t.kind==='task');
    return Array.isArray(ids) ? ids.filter(id=>available.some(t=>t.id===id)).slice(0,3)
      : available.slice().sort((a,b)=>(b.priority==='high')-(a.priority==='high') || taskComparator(a,b)).slice(0,3).map(t=>t.id);
  }
  function renderCompass() {
    const k=dateKey(selectedDate), b=dayCapacity(k), goal=compass.focus?.[k]||'';
    const chosen=focusPriorityIds(k), goals=chosen.map(id=>tasks.find(t=>t.id===id)).filter(Boolean);
    const projects=(compass.projects||[]).filter(p=>p.deadline>=dateKey(today())).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,2);
    const hasOverdue=tasks.some(t=>!t.completed && t.kind==='task' && !t.fixed && t.date<dateKey(today()));
    const percent=b.budget ? clamp(Math.round(b.planned/b.budget*100),0,100):b.planned?100:0;
    $('compassPanel').innerHTML=`
      <section class="compass-card" aria-label="Daily compass">
        <div class="compass-top"><span class="intel-kicker">01 / SOLENARY COMPASS</span><button class="intel-link" type="button" id="focusEdit">Edit direction ↗</button></div>
        <div class="compass-day">${escapeHTML(fmtDate(fromKey(k),{weekday:'long',month:'long',day:'numeric'}))}</div>
        <h2 class="compass-objective">${goal ? escapeHTML(goal) : 'What matters most today?'}</h2>
        <div class="compass-subtitle">YOUR THREE PRIORITIES <span>${goals.filter(t=>t.completed).length} / ${goals.length} complete</span></div>
        <div class="compass-priorities">${goals.length?goals.map((t,i)=>`<button type="button" class="compass-priority ${t.completed?'finished':''}" data-compass-check="${escapeHTML(t.id)}"><span class="priority-square">${t.completed?'✓':''}</span><span class="priority-label">${escapeHTML(t.title)}</span><span class="priority-index">0${i+1}</span></button>`).join(''):'<p class="compass-placeholder">Create tasks for this date, then choose the three that matter most.</p>'}</div>
      </section>
      <section class="planning-card" aria-label="Daily workload reality check">
        <div class="compass-top"><span class="intel-kicker">02 / REALITY CHECK</span><button type="button" class="intel-link" id="openPlannerSettings">Set hours ↗</button></div>
        <div class="reality-numbers"><div><span class="reality-amount">${fmtDuration(b.planned)}</span><span class="reality-label">WORK PLANNED</span></div><div><span class="reality-amount">${fmtDuration(b.budget)}</span><span class="reality-label">USABLE TIME</span></div></div>
        <div class="reality-track"><div class="reality-fill ${b.remaining<0?'excess':''}" style="width:${percent}%"></div></div>
        <p class="reality-note ${b.remaining<0?'warning':''}">${b.schoolBlocked?`${fmtDuration(b.schoolBlocked)} of weekly school/work hours blocked. `:''}${b.remaining<0?`Overbooked by ${fmtDuration(-b.remaining)}. Consider moving flexible work.`:`${fmtDuration(b.remaining)} of flexible time remains.`}${b.collisions?` ${b.collisions} overlapping calendar pair${b.collisions===1?'':'s'} detected.`:''}</p>
        <div class="intel-actions"><button type="button" id="openRunway">+ Deadline runway</button><button type="button" id="openCatchup">${hasOverdue?'● ':''}Rebuild week</button><button type="button" id="openReview">Weekly review</button><button type="button" id="openWeeklyHours">Weekly hours ↗</button><button type="button" id="openChatgpt">Share with ChatGPT ↗</button></div>
        <div class="project-strip">${projects.length?projects.map(p=>{const sessions=tasks.filter(t=>t.projectId===p.id);return `<div class="project-line"><span>${escapeHTML(p.title)}</span><small>${escapeHTML(fmtDate(fromKey(p.deadline),{month:'short',day:'numeric'}))} · ${sessions.filter(t=>t.completed).length}/${sessions.length}</small></div>`;}).join(''):'<span>No upcoming deadline projects. Make one with Deadline runway.</span>'}</div>
      </section>`;
  }
  function openFocus() {
    const key=dateKey(selectedDate), candidates=dayTasks(key).filter(t=>t.kind==='task').sort(taskComparator);
    $('focusDay').textContent=fmtDate(fromKey(key),{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    $('focusObjective').value=compass.focus?.[key]||'';
    const ids=focusPriorityIds(key);
    $('focusChoices').innerHTML=candidates.length?candidates.map(t=>`<label class="choice-item"><input type="checkbox" class="focus-pick" value="${escapeHTML(t.id)}" ${ids.includes(t.id)?'checked':''}><span>${escapeHTML(t.title)}</span><small>${escapeHTML(timeLabel(t.start))}</small></label>`).join(''):'<p class="helper">There are no tasks scheduled for this date. Add them to your calendar first.</p>';
    showDialog('focusDialog');
  }
  async function persistCompass(next) {
    const updated={...next,version:1};
    const {error}=await client.from('daymark_tasks').upsert([{user_id:userId,task_id:META_ID,task:updated,updated_at:new Date().toISOString()}],{onConflict:'user_id,task_id'});
    if(error)throw new Error(error.message);
    compass=updated;
    renderCompass();
  }
  async function saveFocus(e) {
    e.preventDefault();
    const key=dateKey(selectedDate), picked=Array.from(document.querySelectorAll('.focus-pick:checked')).map(el=>el.value);
    if(picked.length>3){notify('Choose at most three priorities.');return;}
    $('saveFocus').disabled=true;
    try {
      await persistCompass({...compass,focus:{...compass.focus,[key]:$('focusObjective').value.trim().slice(0,180)},priorityIds:{...compass.priorityIds,[key]:picked}});
      closeDialog('focusDialog');notify('Daily direction saved to your account.');
    } catch(err){notify(`Could not save direction: ${err.message}`);}finally{$('saveFocus').disabled=false;}
  }
  function occupiedSlots(key,extra=[]) {
    const existing=dayTasks(key).filter(t=>!t.completed).map(t=>t.allDay?[0,1440]:[minutes(t.start),minutes(t.end)]).concat(weeklySpans(key));
    return existing.concat(extra);
  }
  function findFreeSlot(key,duration,preferred,extra=[]) {
    const start=minutes(compass.workStart),end=minutes(compass.workEnd);
    const all=occupiedSlots(key,extra),options=[];
    for(let minute=start;minute+duration<=end;minute+=15){
      if(!all.some(span=>spanOverlap([minute,minute+duration],span)))options.push(minute);
    }
    options.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred)||a-b);
    return options.length?options[0]:null;
  }
  let runwayPreview=[];
  function openRunwayDialog() {
    $('runwayForm').reset();$('runwayStart').value=dateKey(today());
    $('runwayDeadline').value=dateKey(addDays(today(),14));$('runwayPreferred').value='16:00';
    $('runwayPreview').innerHTML='';runwayPreview=[];
    $('runwaySave').disabled=true;showDialog('runwayDialog');
  }
  function calculateRunway(e) {
    if(e)e.preventDefault();
    const title=$('runwayProject').value.trim().slice(0,120),start=$('runwayStart').value,deadline=$('runwayDeadline').value;
    const count=Number($('runwaySessions').value),duration=Number($('runwayDuration').value),preferred=minutes($('runwayPreferred').value||'16:00');
    if(!title||!validDate(start)||!validDate(deadline)||start>=deadline||deadline<=dateKey(today())||count<1||count>24){notify('Enter a valid project, a future deadline, and 1–24 sessions.');return;}
    const beginning=start<dateKey(today())?dateKey(today()):start;
    const days=[];for(let d=fromKey(beginning);dateKey(d)<deadline&&days.length<366;d=addDays(d,1))days.push(dateKey(d));
    if(!days.length){notify('Choose a deadline after the start date.');return;}
    const added={}, proposed=[];
    for(let i=0;i<count;i++){
      const target=Math.min(days.length-1,Math.floor((i+0.5)*days.length/count));
      let found=null;
      for(let offset=0;offset<days.length && !found;offset++){
        for(const dir of [0,-1,1]){
          if(offset===0&&dir!==0)continue;if(offset>0&&dir===0)continue;
          const idx=target+offset*dir;if(idx<0||idx>=days.length)continue;
          const day=days[idx],position=findFreeSlot(day,duration,preferred,added[day]||[]);
          if(position!==null){found={day,position};break;}
        }
      }
      if(!found)break;
      (added[found.day] ||= []).push([found.position,found.position+duration]);
      proposed.push({date:found.day,start:asTime(found.position),end:asTime(found.position+duration)});
    }
    runwayPreview=proposed.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
    $('runwayPreview').innerHTML=`<div class="preview-header">${runwayPreview.length} of ${count} sessions fit before the deadline</div>${runwayPreview.length?runwayPreview.map((p,i)=>`<div class="preview-row"><strong>${i+1}.</strong> ${escapeHTML(fmtDate(fromKey(p.date),{weekday:'short',month:'short',day:'numeric'}))}<span>${escapeHTML(timeLabel(p.start))} – ${escapeHTML(timeLabel(p.end))}</span></div>`).join(''):'<p class="helper">No free slots fit your planning hours. Change the duration or working hours.</p>'}${runwayPreview.length<count?'<p class="helper">Some sessions could not fit. Nothing will be added until you approve.</p>':''}`;
    $('runwaySave').disabled=!runwayPreview.length;
  }
  async function saveRunway() {
    if(!runwayPreview.length)return;
    const projectId=randomId(),title=$('runwayProject').value.trim().slice(0,120),deadline=$('runwayDeadline').value;
    const category=$('runwayCategory').value;
    const created=runwayPreview.map((p,i)=>({id:randomId(),title:`${title} · session ${i+1}/${runwayPreview.length}`,date:p.date,start:p.start,end:p.end,allDay:false,kind:'task',priority:'normal',category,reminder:'none',notes:`Project deadline: ${deadline}`,completed:false,projectId,estimateMinutes:minutes(p.end)-minutes(p.start),fixed:false}));
    $('runwaySave').disabled=true;
    try {
      await cloudUpsert(created);tasks.push(...created);
      const record={id:projectId,title,deadline,createdAt:new Date().toISOString()};
      await persistCompass({...compass,projects:[...(compass.projects||[]),record]});
      runwayPreview=[];closeDialog('runwayDialog');render();notify(`${created.length} project sessions added to your calendar.`);
    }catch(err){await reloadCloud().catch(()=>{});notify(`Could not finish creating this plan: ${err.message}. Check the calendar before trying again.`);}
    finally{$('runwaySave').disabled=false;}
  }
  let catchupPreview=[];
  function openCatchupDialog() {
    const overdue=tasks.filter(t=>!t.completed&&t.kind==='task'&&!t.fixed&&t.date<dateKey(today())).sort((a,b)=>(b.priority==='high')-(a.priority==='high')||taskComparator(a,b));
    const reserved={}, proposals=[];
    for(const old of overdue){
      let dest=null;const length=Math.max(30,scheduledMinutes(old));
      for(let dayNumber=0;dayNumber<14&&!dest;dayNumber++){
        const key=dateKey(addDays(today(),dayNumber));
        const pos=findFreeSlot(key,length,validTime(old.start)?minutes(old.start):16*60,reserved[key]||[]);
        if(pos!==null){dest={date:key,start:asTime(pos),end:asTime(pos+length)};(reserved[key]||=[]).push([pos,pos+length]);}
      }
      if(dest)proposals.push({old,newTask:{...old,...dest,allDay:false,estimateMinutes:length,deferredCount:(old.deferredCount||0)+1}});
    }
    catchupPreview=proposals;
    $('catchupBody').innerHTML=overdue.length?`<p class="helper">These are suggestions for unfinished, movable tasks dated before today. Fixed events and reminders stay in place.</p>${proposals.map(p=>`<div class="preview-row multi"><div><strong>${escapeHTML(p.old.title)}</strong><small>${p.old.date} → ${p.newTask.date}</small></div><span>${escapeHTML(timeLabel(p.newTask.start))}</span></div>`).join('')}${overdue.length>proposals.length?`<p class="helper">${overdue.length-proposals.length} task(s) could not fit in the next 14 days.</p>`:''}`:'<p class="helper">No overdue flexible tasks. Your week needs no rebuilding.</p>';
    $('catchupSave').disabled=!proposals.length;
    showDialog('catchupDialog');
  }
  async function saveCatchup() {
    const updated=catchupPreview.map(x=>x.newTask);if(!updated.length)return;
    $('catchupSave').disabled=true;
    try {await cloudUpsert(updated);tasks=tasks.map(t=>updated.find(x=>x.id===t.id)||t);catchupPreview=[];closeDialog('catchupDialog');render();notify(`${updated.length} tasks rescheduled and synced.`);}
    catch(err){notify(`Could not rebuild: ${err.message}`);}
    finally{$('catchupSave').disabled=false;}
  }
  function openWeeklyReview() {
    const start=weekStartDate(selectedDate),first=dateKey(start),last=dateKey(addDays(start,6));
    const list=tasks.filter(t=>t.date>=first&&t.date<=last&&t.kind==='task');
    const done=list.filter(t=>t.completed),missing=list.filter(t=>!t.completed);
    const completeRate=list.length?Math.round(done.length/list.length*100):0;
    const documented=done.filter(t=>Number(t.actualMinutes)>0);
    const estimated=documented.reduce((n,t)=>n+scheduledMinutes(t),0),actual=documented.reduce((n,t)=>n+Number(t.actualMinutes),0);
    const deffered=list.filter(t=>(t.deferredCount||0)>0).length;
    const weeklyHours=Array.from({length:7},(_,i)=>weeklySpans(dateKey(addDays(start,i)))).reduce((sum,spans)=>sum+mergeSpanLength(spans),0);
    $('reviewPeriod').textContent=`${shortDate(start)} – ${shortDate(addDays(start,6))}`;
    $('reviewMetrics').innerHTML=`<div class="reflection-stats"><div><strong>${completeRate}%</strong><span>COMPLETE</span></div><div><strong>${done.length} / ${list.length}</strong><span>TASKS</span></div><div><strong>${deffered}</strong><span>RESCHEDULED</span></div></div><p class="helper">${missing.length?`${missing.length} unfinished task(s) remain on this week’s calendar.`:'No unfinished tasks in this week.'} ${documented.length?`For ${documented.length} completed task(s) with logged actual time: estimated ${fmtDuration(estimated)}, actual ${fmtDuration(actual)}.`:'Log actual time in completed tasks to compare your estimates with reality.'} Regular school/work time this week: ${fmtDuration(weeklyHours)}.</p>`;
    $('reviewNotes').value=compass.reviews?.[first]||'';
    showDialog('reviewDialog');
  }
  async function saveReview(e){
    e.preventDefault();const first=periodKey(selectedDate);
    $('saveReview').disabled=true;
    try{await persistCompass({...compass,reviews:{...compass.reviews,[first]:$('reviewNotes').value.trim().slice(0,1200)}});closeDialog('reviewDialog');notify('Reflection saved to your account.');}
    catch(err){notify(`Could not save reflection: ${err.message}`);}
    finally{$('saveReview').disabled=false;}
  }
  function makeChatGPTBrief(scope,includeNotes) {
    const start=scope==='today'?fromKey(dateKey(selectedDate)):today();
    const end=scope==='today'?start:addDays(start,6),first=dateKey(start),last=dateKey(end);
    const relevant=tasks.filter(t=>t.date>=first&&t.date<=last).sort(taskComparator);
    const focusDates=Object.keys(compass.focus||{}).filter(k=>k>=first&&k<=last&&compass.focus[k]);
    let lines=['SOLENARY PLANNING BRIEF',`Range: ${first} through ${last}`,'Please help me prioritize and make a realistic schedule. Do not assume changes are already made in Solenary.','','Daily objectives:'];
    lines.push(...(focusDates.length?focusDates.map(k=>`- ${k}: ${compass.focus[k]}`):['- Not set']));
    lines.push('','Regular weekly school/work schedule:',...(activeWeeklyBlocks().length?activeWeeklyBlocks().map(b=>`- ${b.name}: ${[1,2,3,4,5,6,0].filter(d=>b.days.includes(d)).map(d=>weekDays[d]).join(', ')} ${b.start}–${b.end}`):['- None']));
    lines.push('','Tasks & reminders:');
    lines.push(...(relevant.length?relevant.map(t=>`- ${t.date} ${t.allDay?'all day':t.start+'–'+t.end} | ${t.completed?'DONE':'OPEN'} | ${t.priority==='high'?'HIGH PRIORITY | ':''}${t.title} | ${t.seriesId?'weekly recurring':t.kind}${t.location?' | location: '+t.location:''} | duration ${t.allDay?'all day':fmtDuration(scheduledMinutes(t))}${includeNotes&&t.notes?' | notes: '+t.notes.replace(/\s+/g,' ').slice(0,220):''}`):['- No items']));
    const due=(compass.projects||[]).filter(p=>p.deadline>=first&&p.deadline<=dateKey(addDays(end,21)));
    lines.push('','Upcoming project deadlines:',...(due.length?due.map(p=>`- ${p.title}: ${p.deadline}`):['- None']));
    lines.push('','Only use the information I have provided. Ask before making any changes.');
    return lines.join('\n');
  }
  function refreshChatBrief(){$('chatBrief').value=makeChatGPTBrief($('chatScope').value,$('chatNotes').checked);}
  function openChatDialog(){$('chatScope').value='week';$('chatNotes').checked=false;refreshChatBrief();showDialog('chatDialog');}
  async function copyChatBrief(){
    const contents=$('chatBrief').value;
    try {await navigator.clipboard.writeText(contents);notify('Copied. Open ChatGPT and paste the brief into a chat.');}
    catch { $('chatBrief').focus();$('chatBrief').select();notify('Select and copy the text (Ctrl+C), then paste it into ChatGPT.'); }
  }
  function updateWorkWindow() {
    const workStart=$('settingWorkStart').value,workEnd=$('settingWorkEnd').value;
    if(!validTime(workStart)||!validTime(workEnd)||minutes(workEnd)-minutes(workStart)<60){notify('Planning window must be at least one hour long.');return;}
    const next={...compass,workStart,workEnd,bufferMinutes:Number($('settingBuffer').value)};
    persistCompass(next).catch(err=>notify(`Could not save planning hours: ${err.message}`));
  }
  // Solenary Regular Week: weekly repeating school/work hours saved in user-owned compass metadata.
  function resetWeeklyHoursForm(){
    $('weeklyHoursForm').reset();$('weeklyHoursEditingId').value='';
    $('weeklyHoursName').value='School';$('weeklyHoursStart').value='08:00';$('weeklyHoursEnd').value='15:00';
    setWeeklyDays([1,2,3,4,5]);$('weeklyHoursSave').textContent='Save weekly block';
  }
  function setWeeklyDays(days){
    document.querySelectorAll('#weeklyDayPicks input[type="checkbox"]').forEach(c=>c.checked=days.includes(Number(c.value)));
  }
  function getWeeklyDays(){
    return [...document.querySelectorAll('#weeklyDayPicks input:checked')].map(c=>Number(c.value));
  }
  function renderWeeklyHours(){
    const blocks=activeWeeklyBlocks();
    $('weeklyHoursList').innerHTML=blocks.length?blocks.map(b=>`<div class="weekly-hours-entry"><div><strong>${escapeHTML(b.name)}</strong><small>${[1,2,3,4,5,6,0].filter(d=>b.days.includes(d)).map(d=>weekDays[d]).join(', ')} · ${escapeHTML(timeLabel(b.start))}–${escapeHTML(timeLabel(b.end))} · ${fmtDuration(minutes(b.end)-minutes(b.start))} per day</small></div><div><button class="text-button border-button" type="button" data-weekly-edit="${escapeHTML(b.id)}">Edit</button><button class="delete-button" type="button" data-weekly-delete="${escapeHTML(b.id)}">Remove</button></div></div>`).join(''):'<p class="helper">No repeating school/work blocks yet. Add your regular schedule above.</p>';
    let total=0;
    $('weeklyHoursTotals').innerHTML=[1,2,3,4,5,6,0].map(d=>{
      const spans=blocks.filter(b=>b.days.includes(d)).map(b=>[minutes(b.start),minutes(b.end)]);
      const mins=mergeSpanLength(spans);total+=mins;
      return `<div><span>${weekDays[d]}</span><strong>${fmtDuration(mins)}</strong></div>`;
    }).join('')+`<div class="weekly-total"><span>WEEKLY TOTAL</span><strong>${fmtDuration(total)}</strong></div>`;
  }
  function openWeeklyHours(){
    if($('settingsDialog').open)closeDialog('settingsDialog');
    resetWeeklyHoursForm();renderWeeklyHours();showDialog('weeklyHoursDialog');
  }
  async function saveWeeklyHours(e){
    e.preventDefault();
    const name=$('weeklyHoursName').value.trim(),start=$('weeklyHoursStart').value,end=$('weeklyHoursEnd').value;
    const days=getWeeklyDays();
    if(!name||!days.length||!validTime(start)||!validTime(end)||minutes(end)<=minutes(start)){
      notify('Enter a label, valid start/end times and at least one weekday.');return;
    }
    const id=$('weeklyHoursEditingId').value||randomId();
    const prior=activeWeeklyBlocks();
    const next=prior.filter(b=>b.id!==id).concat([{id,name:name.slice(0,80),start,end,days}]);
    if(next.length>30){notify('Please use at most 30 weekly blocks.');return;}
    $('weeklyHoursSave').disabled=true;
    try{await persistCompass({...compass,weeklyCommitments:next});resetWeeklyHoursForm();renderWeeklyHours();render();notify('Weekly hours saved to your account.');}
    catch(error){notify(`Could not save weekly hours: ${error.message}`);}
    finally{$('weeklyHoursSave').disabled=false;}
  }
  function editWeeklyHours(id){
    const item=activeWeeklyBlocks().find(b=>b.id===id);if(!item)return;
    $('weeklyHoursEditingId').value=item.id;$('weeklyHoursName').value=item.name;
    $('weeklyHoursStart').value=item.start;$('weeklyHoursEnd').value=item.end;
    setWeeklyDays(item.days);$('weeklyHoursSave').textContent='Update weekly block';
    $('weeklyHoursName').focus();
  }
  async function removeWeeklyHours(id){
    const item=activeWeeklyBlocks().find(b=>b.id===id);if(!item)return;
    if(!confirm(`Remove the regular ${item.name} schedule? This will not delete calendar tasks.`))return;
    try{await persistCompass({...compass,weeklyCommitments:activeWeeklyBlocks().filter(b=>b.id!==id)});renderWeeklyHours();render();notify('Weekly block removed.');}
    catch(error){notify(`Could not remove weekly block: ${error.message}`);}
  }
  // The existing calendar stays in charge. Compass simply decorates the current view.
  const baseRender = render;
  render = function(){ baseRender(); renderCompass(); };
  document.addEventListener('click',async (e)=>{
    const id=e.target.closest('[data-compass-check]')?.dataset.compassCheck;
    if(id){
      const existing=tasks.find(t=>t.id===id);if(!existing)return;
      const updated={...existing,completed:!existing.completed,completedAt:existing.completed?null:new Date().toISOString()};
      try{await cloudUpsert([updated]);tasks=tasks.map(t=>t.id===id?updated:t);render();notify(updated.completed?'Priority completed.':'Priority reopened.');}
      catch(err){notify(`Could not update task: ${err.message}`);}
    }
  });
  document.addEventListener('click',(e)=>{
    const btn=e.target.closest('button');if(!btn)return;
    const callbacks={focusEdit:openFocus,openPlannerSettings:openSettings,openRunway:openRunwayDialog,
      openCatchup:openCatchupDialog,openReview:openWeeklyReview,openChatgpt:openChatDialog,openWeeklyHours:openWeeklyHours};
    if(callbacks[btn.id])callbacks[btn.id]();
  });
  $('focusForm').addEventListener('submit',saveFocus);
  $('focusChoices').addEventListener('change',e=>{
    if(e.target.classList.contains('focus-pick') && document.querySelectorAll('.focus-pick:checked').length>3){
      e.target.checked=false;notify('Choose up to three priorities.');
    }
  });
  $('runwayForm').addEventListener('submit',calculateRunway);
  $('runwaySave').addEventListener('click',saveRunway);
  $('catchupSave').addEventListener('click',saveCatchup);
  $('reviewForm').addEventListener('submit',saveReview);
  $('chatScope').addEventListener('change',refreshChatBrief);
  $('chatNotes').addEventListener('change',refreshChatBrief);
  $('copyChatBrief').addEventListener('click',copyChatBrief);
  $('openChatGPTSite').addEventListener('click',()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer'));
  $('downloadChatBrief').addEventListener('click',()=>downloadFile($('chatBrief').value,`solenary-chatgpt-brief-${dateKey(today())}.txt`,'text/plain'));
  ['settingWorkStart','settingWorkEnd','settingBuffer'].forEach(id=>$(id).addEventListener('change',updateWorkWindow));

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
  });
  $('taskForm').addEventListener('submit',saveTask);
  $('taskResourceOpen').addEventListener('click',()=>{const url=validResourceUrl($('taskResource').value);if(url)window.open(url,'_blank','noopener,noreferrer');});
  $('taskResource').addEventListener('input',()=>{$('taskResourceOpen').hidden=!validResourceUrl($('taskResource').value);});
  $('taskAllDay').addEventListener('change',toggleTimeInputs);
  ['taskStart','taskEnd'].forEach(id=>$(id).addEventListener('input',updateDurationLabel));
  $('taskDate').addEventListener('change',renderRepeatWeeks);
  $('taskRepeatHorizon').addEventListener('change',()=>{const size=Number($('taskRepeatHorizon').value);repeatOffsets=new Set([...repeatOffsets].filter(i=>i<size));renderRepeatWeeks();});
  $('taskRepeatWeeks').addEventListener('change',e=>{const i=Number(e.target.dataset.weekIndex);if(!Number.isInteger(i))return; if(e.target.checked)repeatOffsets.add(i);else repeatOffsets.delete(i);});
  $('repeatSelectAll').addEventListener('click',()=>{repeatOffsets=new Set(Array.from({length:Number($('taskRepeatHorizon').value)},(_,i)=>i));renderRepeatWeeks();});
  $('repeatClear').addEventListener('click',()=>{repeatOffsets.clear();renderRepeatWeeks();});
  $('taskEditSeries').addEventListener('change',()=>{
    const old=tasks.find(t=>t.id===editingId);
    if(old){$('taskDate').value=$('taskEditSeries').checked?seriesItems(editingSeries)[0]?.date||old.date:old.date;}
    renderRepeatWeeks();
  });
  $('taskKind').addEventListener('change',()=>{const old=tasks.find(t=>t.id===editingId);if(old?.seriesId)$('taskDate').value=$('taskKind').value==='weekly'?(seriesItems(old.seriesId)[0]?.date||old.date):old.date;if($('taskKind').value==='reminder'&&$('taskReminder').value==='none')$('taskReminder').value='15';toggleTimeInputs();renderRepeatWeeks();});
  $('deleteTask').addEventListener('click',async()=>{
    if(!editingId)return;
    if(!confirm('Delete this task or reminder? If it is linked to Google Calendar and two-way sync is enabled, the Google event may also be removed automatically.'))return;
    $('deleteTask').disabled=true;
    try { await cloudDelete([editingId]);tasks=tasks.filter(t=>t.id!==editingId);closeDialog('taskDialog');render();notify('Item deleted.'); }
    catch(err){notify(`Could not delete: ${err.message}`);}
    finally{$('deleteTask').disabled=false;}
  });
  $('deleteSeries').addEventListener('click',async()=>{
    if(!editingSeries)return;
    const occurrences=seriesItems(editingSeries);
    if(!confirm(`Delete all ${occurrences.length} dates in this recurring series? Linked Google Calendar events may also be removed when two-way sync is enabled.`))return;
    $('deleteSeries').disabled=true;
    try{await cloudDelete(occurrences.map(t=>t.id));tasks=tasks.filter(t=>t.seriesId!==editingSeries);closeDialog('taskDialog');render();notify('Recurring series deleted.');}
    catch(e){await reloadCloud().catch(()=>{});notify(`Could not delete series: ${e.message}`);}
    finally{$('deleteSeries').disabled=false;}
  });
  $('weeklyHoursOpen').addEventListener('click',openWeeklyHours);
  $('settingsWeeklyHours').addEventListener('click',openWeeklyHours);
  $('weeklyHoursForm').addEventListener('submit',saveWeeklyHours);
  $('weeklyHoursReset').addEventListener('click',resetWeeklyHoursForm);
  $('weeklyPresetWeekdays').addEventListener('click',()=>setWeeklyDays([1,2,3,4,5]));
  $('weeklyPresetEveryday').addEventListener('click',()=>setWeeklyDays([0,1,2,3,4,5,6]));
  $('weeklyPresetClear').addEventListener('click',()=>setWeeklyDays([]));
  $('weeklyHoursList').addEventListener('click',e=>{
    const edit=e.target.closest('[data-weekly-edit]');if(edit){editWeeklyHours(edit.dataset.weeklyEdit);return;}
    const remove=e.target.closest('[data-weekly-delete]');if(remove)removeWeeklyHours(remove.dataset.weeklyDelete);
  });
  $('newTaskTop').addEventListener('click',()=>openTask(null,dateKey(selectedDate)));
  $('newTaskMobile').addEventListener('click',()=>openTask(null,dateKey(selectedDate)));
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
  $('settingCannonStudent').addEventListener('change',()=>{
    $('settingCannonDivisionGroup').hidden=!$('settingCannonStudent').checked;
    $('schoolSettingStatus').textContent='Save your school selection to update the workspace.';
  });
  $('saveSchoolAffiliation').addEventListener('click',async()=>{
    const isCannon=$('settingCannonStudent').checked;
    const division=isCannon?$('settingCannonDivision').value:null;
    if(isCannon && !['middle','upper'].includes(division)){
      $('schoolSettingStatus').textContent='Choose Middle School or Upper School first.';
      return;
    }
    const button=$('saveSchoolAffiliation');button.disabled=true;
    $('schoolSettingStatus').textContent='Saving school selection…';
    try {
      const {data,error}=await client.auth.updateUser({data:{
        solenary_school:isCannon?'cannon':null,
        solenary_school_division:isCannon?division:null
      }});
      if(error)throw error;
      schoolProfile.school=data?.user?.user_metadata?.solenary_school==='cannon'?'cannon':null;
      schoolProfile.division=['middle','upper'].includes(data?.user?.user_metadata?.solenary_school_division)
        ?data.user.user_metadata.solenary_school_division:null;
      updateCannonLink();
      $('schoolSettingStatus').textContent=schoolProfile.school==='cannon' && schoolProfile.division==='upper'
        ?'Saved. Cannon US Planner is now available under Your workspace.'
        :'Saved. Your workspace has been updated.';
      notify('School preferences saved.');
    } catch(err){
      $('schoolSettingStatus').textContent=`Could not save: ${err.message||'Connection issue'}`;
    } finally{button.disabled=false;}
  });
  ['settingWeekStart','settingTimeFormat','settingDuration'].forEach(id=>$(id).addEventListener('change',settingsChanged));
  $('settingNotifications').addEventListener('change',notificationsChanged);
  $('clearDataButton').addEventListener('click',async()=>{
    if(!confirm(`Permanently delete all ${tasks.length} tasks and reminders from your account? If Google two-way sync is enabled, linked Google Calendar events may also be deleted on the next sync. Download backups of both calendars first.`))return;
    $('clearDataButton').disabled=true;
    try {
      const {error}=await client.from('daymark_tasks').delete().eq('user_id',userId);
      if(error)throw new Error(error.message);
      tasks=[];compass={...defaultCompass};closeDialog('settingsDialog');render();notify('All account tasks and planning goals deleted.');
      window.dispatchEvent(new CustomEvent('solenary:tasks-changed',{detail:{action:'clear',count:0}}));
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
