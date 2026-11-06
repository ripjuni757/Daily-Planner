'use strict';
// Cannon US Planner: independent student-built timetable from photographed 2026–27 planner pages.
(async function(){
  const $=id=>document.getElementById(id);
  const boot=$('cannonBoot');
  const client=window.daymarkClient;
  if(!client){boot.textContent='Supabase configuration is missing. Open the main Solenary planner first.';return;}
  let user;
  try{const {data,error}=await client.auth.getUser();if(error||!data?.user){location.replace('login.html');return;}user=data.user;}
  catch(e){boot.textContent='Could not verify your account. Check your connection and reload.';return;}
  const school=user.user_metadata?.solenary_school;
  const division=user.user_metadata?.solenary_school_division;
  if(school!=='cannon' || division!=='upper'){
    boot.innerHTML='This workspace is for Cannon Upper School accounts. To enable it, open <a href="index.html">Solenary → Settings → School affiliation</a> and select Cannon School / Upper School.';
    return;
  }
  const USER_ID=user.id;
  const PROFILE_ID='__solenary_cannon_us_profile_v1__';
  const emptyClass=()=>({name:'',teacher:'',room:''});
  const defaults=()=>({version:1,classes:Object.fromEntries('ABCDEF'.split('').map(a=>[a,emptyClass()])),advisory:'',zeroHour:'',overrides:{},daily:{}});
  let profile=defaults();
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');
  const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseDate=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d,12)};
  const plusDays=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,12);
  const monday=d=>plusDays(d,-((d.getDay()+6)%7));
  const fmt=(d,opts)=>new Intl.DateTimeFormat('en-US',opts).format(d);
  const make=(mode,drop,notice='',variant='')=>({mode,drop,notice,variant});
  const printed={
    '2026-11-09':make('six','Social Studies Drop','Six-block / Success Day','core'),
    '2026-11-10':make('1','World Language Drop'),
    '2026-11-11':make('2','World Language Drop (E, F)'),
    '2026-11-12':make('3','Math Drop'),
    '2026-11-13':make('1','Math Drop (A, C)'),
    '2026-11-16':make('2','Social Studies Drop'),
    '2026-11-17':make('3','Social Studies Drop (D, B)'),
    '2026-11-18':make('six','Arts Drop','Six-block day','student'),
    '2026-11-19':make('1','No Drop','Special schedule — start cycle'),
    '2026-11-20':make('early','No Drop','Special schedule — finish cycle. Buses at 11:45.'),
    '2026-11-30':make('1','English Drop'),
    '2026-12-01':make('2','English Drop (E, F)'),
    '2026-12-02':make('3','Science Drop'),
    '2026-12-03':make('1','Science Drop (A, C)'),
    '2026-12-04':make('2','World Language Drop'),
    '2026-12-07':make('3','World Language Drop (D, B)'),
    '2026-12-08':make('1','Math Drop'),
    '2026-12-09':make('2','Math Drop (E, F)'),
    '2026-12-10':make('3','Social Studies Drop'),
    '2026-12-11':make('assembly','No Drop','Project Wrap-In • Stadium assembly • Pancake breakfast • Talent show • Buses leave 11:45'),
    '2026-12-14':make('1','Social Studies Drop (A, C)'),
    '2026-12-15':make('2','Arts Drop'),
    '2026-12-16':make('3','Arts Drop (D, B)','Special schedule: Student Life 11:40–12:25','student-early'),
    '2026-12-17':make('1','No Drop','Special schedule — start cycle'),
    '2026-12-18':make('early','No Drop','Special schedule — finish cycle / early dismissal. Buses 11:45.')
  };
  for(let d=parseDate('2026-11-23');dateKey(d)<='2026-11-27';d=plusDays(d,1))printed[dateKey(d)]=make('closed','', 'No school — Thanksgiving Break');
  for(let d=parseDate('2026-12-21');dateKey(d)<='2027-01-01';d=plusDays(d,1)){
    if(d.getDay()!==0&&d.getDay()!==6)printed[dateKey(d)]=make('closed','', 'No school — Winter Break');
  }
  for(let d=parseDate('2027-01-04');dateKey(d)<='2027-01-08';d=plusDays(d,1))printed[dateKey(d)]=make('winterm','', 'Winterm — no regular A–F block rotation');
  printed['2026-11-06']=make('closed','','Parent conferences — no classes');
  const knownMin='2026-11-09',knownMax='2027-01-08';
  let chosen=dateKey(new Date())<knownMin?knownMin:dateKey(new Date());
  let week=monday(parseDate(chosen));
  let toastTimer;
  function alertUser(message){let el=$('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3000)}
  function normClass(raw){return {name:String(raw?.name??'').slice(0,140),teacher:String(raw?.teacher??'').slice(0,120),room:String(raw?.room??'').slice(0,80)}}
  function normalize(saved){const base=defaults(); if(!saved||saved.version!==1)return base;
    for(const l of 'ABCDEF')base.classes[l]=normClass(saved.classes?.[l]);
    base.advisory=String(saved.advisory??'').slice(0,120);
    base.zeroHour=String(saved.zeroHour??'').slice(0,120);
    if(saved.overrides&&typeof saved.overrides==='object'){
      for(const [k,v] of Object.entries(saved.overrides).slice(0,400)){
        if(/^20\d{2}-\d\d-\d\d$/.test(k)&&v&&typeof v==='object')base.overrides[k]={mode:['1','2','3','six','early','closed','special'].includes(v.mode)?v.mode:'',drop:String(v.drop??'').slice(0,140),notice:String(v.notice??'').slice(0,350)};
      }
    }
    if(saved.daily&&typeof saved.daily==='object'){
      for(const [k,v] of Object.entries(saved.daily).slice(0,450)){
        if(/^20\d{2}-\d\d-\d\d$/.test(k)&&v&&typeof v==='object')base.daily[k]={priorities:Array.from({length:3},(_,i)=>String(v.priorities?.[i]??'').slice(0,180)),notes:String(v.notes??'').slice(0,3000)};
      }
    }
    return base;
  }
  try{
    const {data,error}=await client.from('daymark_tasks').select('task').eq('user_id',USER_ID).eq('task_id',PROFILE_ID).maybeSingle();
    if(error)throw error;
    if(data?.task)profile=normalize(data.task);
  }catch(e){boot.textContent=`Could not load Cannon planner: ${e.message||'Database error'}. Please check your account and Supabase setup.`;return;}
  let saving=false,saveQueued=false;
  async function saveProfile(){
    if(saving){saveQueued=true;return;}
    saving=true;
    do{
      saveQueued=false;
      const snapshot=JSON.parse(JSON.stringify(profile));
      try{
        const {error}=await client.from('daymark_tasks').upsert({user_id:USER_ID,task_id:PROFILE_ID,task:snapshot,updated_at:new Date().toISOString()},{onConflict:'user_id,task_id'});
        if(error)throw error;
        $('saveStatus').textContent='Saved to your Solenary account.';
      }catch(e){$('saveStatus').textContent='Save failed. Please try again.';alertUser('Could not save: '+(e.message||'connection error'));}
    }while(saveQueued);
    saving=false;
  }
  const modeName={1:'US Day 1',2:'US Day 2',3:'US Day 3',six:'Six-block day',early:'Early dismissal',assembly:'Special schedule',closed:'No school',winterm:'Winterm',special:'Special schedule'};
  function daySpec(k){const r=printed[k];const override=profile.overrides[k];if(!override)return r||null;
    const mode=override.mode||r?.mode||'';
    if(!mode)return r||null;
    return {mode,drop:override.drop!==''?override.drop:(r?.drop||''),notice:override.notice||r?.notice||'',variant:r?.variant||'student',overridden:true};
  }
  const blocks={1:['A','B','C','D'],2:['E','F','C','A'],3:['D','B','F','E']};
  const block=(type,time,name,extra='')=>({type,time,name,extra});
  const course=(label,time)=>{const c=profile.classes[label]||emptyClass();return block('course',time,`${label} · ${c.name||'Add class name'}`,([c.teacher,c.room].filter(Boolean).join(' • '))||'Add teacher and room in My classes');};
  function schoolBlocks(k,spec){
    if(!spec)return [];
    if(spec.mode==='closed'||spec.mode==='winterm')return [block('closed','',spec.notice||'No regular classes')];
    if(spec.mode==='special')return [block('special','',spec.notice||'Special schedule — see school announcements')];
    const base=[block('zero','7:25–8:05',profile.zeroHour||'Zero Hour'),block('advisory','8:10–8:20',profile.advisory||'Advisory')];
    if(spec.mode==='assembly')return [...base,block('notice','8:30–9:15','Project Wrap-In'),block('notice','9:30–10:00','Assembly in stadium'),block('notice','10:00–10:30','Pancake breakfast'),block('notice','10:30–11:30','Talent show'),block('special','11:45','Buses leave • early dismissal')];
    if(spec.mode==='early')return [...base,course('E','8:25–9:35'),course('F','9:40–10:50'),block('lunch','10:50–11:35','Lunch / early dismissal'),block('special','11:45','Buses leave')];
    if(spec.mode==='six'){
      return [...base,course('A','8:25–9:10'),course('E','9:15–10:00'),course('B','10:05–10:50'),block('lunch','10:50–11:35','Lunch'),course('C','11:40–12:25'),block('flex','12:30–1:15',spec.variant==='core'?'CoRE Time':'Student Life'),course('F','1:20–2:05'),course('D','2:10–2:55'),block('flex','3:00–3:45','Office Hours')];
    }
    const sequence=blocks[spec.mode];if(!sequence)return [];
    const wd=parseDate(k).getDay();
    let flex={1:'CoRE Time',2:'Office Hours',3:'Student Life',4:'Office Hours',5:'Student Life'}[wd]||'Flex period';
    if(spec.variant==='student-early')return [...base,course(sequence[0],'8:25–9:35'),course(sequence[1],'9:40–10:50'),block('lunch','10:50–11:35','Lunch'),block('flex','11:40–12:25','Student Life'),course(sequence[2],'12:30–1:40'),course(sequence[3],'1:45–2:55'),block('flex','3:00–3:45','Office Hours')];
    return [...base,course(sequence[0],'8:25–9:35'),course(sequence[1],'9:40–10:50'),block('lunch','10:50–11:35','Lunch'),course(sequence[2],'11:40–12:50'),block('flex','12:55–1:40',flex),course(sequence[3],'1:45–2:55'),block('flex','3:00–3:45','Office Hours')];
  }
  const months=d=>fmt(d,{month:'long',year:'numeric'});
  function render(){
    const end=plusDays(week,6);const sameMonth=week.getMonth()===end.getMonth();
    $('weekRange').textContent=sameMonth?`${fmt(week,{month:'long'})} ${week.getDate()}–${end.getDate()}, ${week.getFullYear()}`:`${fmt(week,{month:'short',day:'numeric'})} – ${fmt(end,{month:'short',day:'numeric',year:'numeric'})}`;
    $('weekStatus').textContent='Use the arrows to move week by week. Click a school day to edit its priorities or schedule.';
    let html='';
    for(let i=0;i<5;i++){
      const d=plusDays(week,i), k=dateKey(d), spec=daySpec(k), active=k===chosen;
      const dayName=fmt(d,{weekday:'long'});
      const dayTitle=spec?modeName[spec.mode]||'School day':'Rotation not in reference';
      const rows=schoolBlocks(k,spec);
      html+=`<article class="c-day ${active?'is-selected':''}" data-day="${k}">
        <button type="button" class="c-day-header" data-select="${k}" aria-pressed="${active}" aria-label="Select ${escape(dayName)}, ${escape(k)}">
          <span class="c-day-name">${escape(dayName.toUpperCase())}</span><div class="c-day-date">${escape(fmt(d,{month:'short',day:'numeric'}))}</div>
          <div class="c-day-daytype">${escape(dayTitle)}</div>${active?'<span class="c-selected-badge">SELECTED DAY</span>':''}
        </button>
        <div class="c-day-drop ${!spec?.drop?'none':''}">${escape(spec?.drop|| (spec?'No Drop':'Schedule not yet entered'))}</div>
        <div class="c-day-blocks">${!spec?'<p class="c-no-reference">No verified day rotation for this date.<br>Select this day and choose “Edit selected date” to set it.</p>':rows.map(r=>`<div class="c-block ${r.type==='course'?'':escape(r.type)}"><div class="c-time">${escape(r.time||'SCHEDULE NOTICE')}</div><div class="c-name">${escape(r.name)}</div>${r.extra?`<div class="c-extra">${escape(r.extra)}</div>`:''}</div>`).join('')}${spec?.notice&&!['closed','winterm','assembly'].includes(spec.mode)?`<div class="c-block special"><div class="c-name">${escape(spec.notice)}</div></div>`:''}</div>
        </article>`;
    }
    $('weekGrid').innerHTML=html;
    const day=parseDate(chosen),spec=daySpec(chosen);
    $('selectedDateHeading').textContent=fmt(day,{weekday:'long',month:'long',day:'numeric'});
    $('selectedDateStatus').textContent=spec?(modeName[spec.mode]||''):'No rotation entered';
    const daily=profile.daily[chosen]||{priorities:['','',''],notes:''};
    for(let j=0;j<3;j++)$('priority'+(j+1)).value=daily.priorities?.[j]||'';
    $('dailyNotes').value=daily.notes||'';
  }
  $('weekGrid').addEventListener('click',e=>{const b=e.target.closest('[data-select]');if(!b)return;chosen=b.dataset.select;render()});
  function navigate(weeks){week=plusDays(week,weeks*7);chosen=dateKey(week);render();}
  $('prevWeek').addEventListener('click',()=>navigate(-1));$('nextWeek').addEventListener('click',()=>navigate(1));
  $('referenceWeek').addEventListener('click',()=>{chosen='2026-11-09';week=monday(parseDate(chosen));render()});
  $('goToday').addEventListener('click',()=>{const actual=dateKey(new Date());chosen=actual;week=monday(parseDate(actual));render()});
  $('printWeek').addEventListener('click',()=>window.print());
  function openDialog(id){$(id).showModal()}
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close).close()));
  for(const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
  function openClasses(){
    $('courseFields').innerHTML='ABCDEF'.split('').map(l=>{const c=profile.classes[l];return `<fieldset class="c-course"><legend>BLOCK ${l}</legend><label><span>Class / course</span><input data-block="${l}" data-field="name" maxlength="140" value="${escape(c.name)}" placeholder="Class name"></label><label><span>Teacher</span><input data-block="${l}" data-field="teacher" maxlength="120" value="${escape(c.teacher)}" placeholder="Teacher name"></label><label><span>Room</span><input data-block="${l}" data-field="room" maxlength="80" value="${escape(c.room)}" placeholder="Room number"></label></fieldset>`}).join('');
    $('advisorName').value=profile.advisory;$('zeroHourName').value=profile.zeroHour;
    openDialog('courseDialog');
  }
  $('openCourses').addEventListener('click',openClasses);
  $('courseForm').addEventListener('submit',async e=>{e.preventDefault();for(const input of $('courseFields').querySelectorAll('[data-block]'))profile.classes[input.dataset.block][input.dataset.field]=input.value.trim();profile.advisory=$('advisorName').value.trim();profile.zeroHour=$('zeroHourName').value.trim();$('courseDialog').close();render();await saveProfile();alertUser('Your class timetable was saved.')});
  function openDay(){const spec=profile.overrides[chosen];$('dayDialogTitle').textContent=`Edit ${fmt(parseDate(chosen),{month:'short',day:'numeric'})}`;$('dayMode').value=spec?.mode||'';$('dayDrop').value=spec?.drop??'';$('dayNotice').value=spec?.notice??'';openDialog('dayDialog')}
  $('openDayEdit').addEventListener('click',openDay);
  $('dayForm').addEventListener('submit',async e=>{e.preventDefault();let mode=$('dayMode').value;const drop=$('dayDrop').value.trim(),notice=$('dayNotice').value.trim();if(!mode&&!drop&&!notice){delete profile.overrides[chosen]}else{profile.overrides[chosen]={mode,drop,notice}}$('dayDialog').close();render();await saveProfile();alertUser('Day schedule saved.')});
  $('clearDayOverride').addEventListener('click',async()=>{delete profile.overrides[chosen];$('dayDialog').close();render();await saveProfile();alertUser('Restored printed schedule.')});
  $('saveNotes').addEventListener('click',async()=>{const priorities=[1,2,3].map(i=>$('priority'+i).value.trim());const notes=$('dailyNotes').value.trim();if(priorities.some(Boolean)||notes)profile.daily[chosen]={priorities,notes};else delete profile.daily[chosen];$('saveStatus').textContent='Saving…';await saveProfile();});
  $('currentUser').textContent=user.email||'Signed in';
  $('cannonApp').hidden=false;boot.hidden=true;render();
})();
