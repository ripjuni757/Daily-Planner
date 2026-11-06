'use strict';
(async () => {
  const client=window.daymarkClient;
  const $=(id)=>document.getElementById(id);
  if(!client)return;
  const {data: auth, error:authError}=await client.auth.getUser();
  if(authError || !auth?.user)return;
  const me=auth.user.id;
  const personalTaskMeta='__daymark_compass_meta_v1__';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validUUID=x=>/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(String(x||''));
  const openSafe=url=>{ if(typeof url==='string' && /^https:\/\//.test(url))window.open(url,'_blank','noopener,noreferrer'); };
  const short=x=>String(x||'').slice(0,8)+'…';
  const message=(txt,error=false)=>{const e=$('collabStatus');e.textContent=txt||'';e.classList.toggle('error',error);};
  const dateNow=()=>{let d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const formatDate=x=>{ const d=new Date(`${x}T12:00:00`);return Number.isNaN(d.getTime())?x:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  async function readPersonalTasks(){
    const all=[];for(let from=0;;from+=500){
      const {data,error}=await client.from('daymark_tasks').select('task').eq('user_id',me).order('task_id').range(from,from+499);
      if(error)throw error;
      const part=(data||[]).map(x=>x.task).filter(x=>x&&x.id!==personalTaskMeta&&x.title&&/^\d{4}-\d{2}-\d{2}$/.test(x.date));all.push(...part);
      if(!data||data.length<500)break;
    }
    return all.sort((a,b)=>a.date.localeCompare(b.date)||(a.start||'').localeCompare(b.start||''));
  }
  const valueISO=(date,time)=> {if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;return `${date}T${/^\d{2}:\d{2}$/.test(time||'')?time:'09:00'}:00`;};
  const calendarTitle=t=>String(t.title||'Daymark item').slice(0,160);
  function toGCal(t){
    const start=valueISO(t.date,t.start)||`${t.date}T09:00:00`,end=valueISO(t.date,t.end)||`${t.date}T10:00:00`;
    const fmt=x=>x.replace(/[-:]/g,'');
    if(t.allDay){let next=new Date(t.date+'T12:00:00');next.setDate(next.getDate()+1);const nxt=[next.getFullYear(),String(next.getMonth()+1).padStart(2,'0'),String(next.getDate()).padStart(2,'0')].join('');return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarTitle(t))}&dates=${t.date.replace(/-/g,'')}/${nxt}`;}
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarTitle(t))}&dates=${fmt(start)}/${fmt(end)}`;
  }
  function toOutlook(t){
    const p=new URLSearchParams({path:'/calendar/action/compose',rru:'addevent',subject:calendarTitle(t),startdt:valueISO(t.date,t.start)||`${t.date}T09:00:00`,enddt:valueISO(t.date,t.end)||`${t.date}T10:00:00`,allday:String(Boolean(t.allDay))});
    return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
  }
  const foldICS=(line)=>{let out=[];for(let i=0;i<line.length;i+=70)out.push((i?' ':'')+line.slice(i,i+70));return out.join('\r\n');};
  const icsEscape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  function downloadSingleIcs(t){
    const dt=x=>x.replaceAll('-','').replaceAll(':','');
    let st,et;
    if(t.allDay){const next=new Date(t.date+'T12:00:00');next.setDate(next.getDate()+1);const nd=[next.getFullYear(),String(next.getMonth()+1).padStart(2,'0'),String(next.getDate()).padStart(2,'0')].join('');st=`DTSTART;VALUE=DATE:${dt(t.date)}`;et=`DTEND;VALUE=DATE:${nd}`;}
    else {st=`DTSTART:${dt(t.date)}T${dt(t.start||'09:00')}00`;et=`DTEND:${dt(t.date)}T${dt(t.end||'10:00')}00`;}
    const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daymark//EN','BEGIN:VEVENT',`UID:${crypto.randomUUID()}@daymark.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,st,et,`SUMMARY:${icsEscape(calendarTitle(t))}`,'END:VEVENT','END:VCALENDAR'].map(foldICS).join('\r\n')+'\r\n';
    const u=URL.createObjectURL(new Blob([body],{type:'text/calendar'}));const a=document.createElement('a');a.href=u;a.download=`daymark-${t.date}.ics`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
  }
  let integrationTasks=[];
  async function openIntegrations(){
    $('integrationsDialog').showModal();$('integrationTask').replaceChildren(new Option('Loading your tasks…',''));
    try{
      integrationTasks=await readPersonalTasks();
      $('integrationTask').replaceChildren();
      if(!integrationTasks.length){$('integrationTask').add(new Option('No tasks yet—create one first',''));}
      else integrationTasks.forEach(t=>$('integrationTask').add(new Option(`${t.date} · ${calendarTitle(t)}`,t.id)));
    }catch(err){$('integrationTask').replaceChildren(new Option('Unable to load tasks',''));}
  }
  const selectedTask=()=>integrationTasks.find(t=>t.id===$('integrationTask').value);
  function emailSummary(){
    const now=dateNow(),end=new Date();end.setDate(end.getDate()+7);const endKey=[end.getFullYear(),String(end.getMonth()+1).padStart(2,'0'),String(end.getDate()).padStart(2,'0')].join('-');
    const list=integrationTasks.filter(t=>t.date>=now&&t.date<endKey).slice(0,100);
    return `My Daymark plan (next 7 days)\n\n${list.length?list.map(t=>`${t.date} ${t.allDay?'All day':(t.start||'')}  ${calendarTitle(t)}`).join('\n'):'No upcoming tasks.'}\n\nSent from Daymark. Review before sharing.`;
  }
  $('integrationsOpen').addEventListener('click',openIntegrations);
  $('integrationGoogleCal').addEventListener('click',()=>{const t=selectedTask();if(t)openSafe(toGCal(t));});
  $('integrationOutlookCal').addEventListener('click',()=>{const t=selectedTask();if(t)openSafe(toOutlook(t));});
  $('integrationIcs').addEventListener('click',()=>{const t=selectedTask();if(t)downloadSingleIcs(t);});
  $('integrationGmail').addEventListener('click',()=>openSafe(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('My Daymark plan')}&body=${encodeURIComponent(emailSummary())}`));
  $('integrationOutlookMail').addEventListener('click',()=>openSafe(`https://outlook.live.com/mail/0/deeplink/compose?${new URLSearchParams({subject:'My Daymark plan',body:emailSummary()})}`));
  $('integrationMailto').addEventListener('click',()=>{location.href=`mailto:?subject=${encodeURIComponent('My Daymark plan')}&body=${encodeURIComponent(emailSummary())}`;});
  document.querySelectorAll('[data-service-url]').forEach(b=>b.addEventListener('click',()=>openSafe(b.dataset.serviceUrl)));
  $('integrationFullIcs').addEventListener('click',()=>{$('exportIcsButton').click();});
  $('integrationImport').addEventListener('click',()=>{$('importInput').click();});
  $('integrationChat').addEventListener('click',()=>{$('integrationsDialog').close();const btn=$('openChatgpt');if(btn)btn.click();});

  // Collaboration (Supabase + row-level security) — personal calendars are never exposed here.
  let spaces=[],currentSpace=null, members=[],sharedTasks=[];
  $('collabMyId').textContent=me;
  $('collabTaskDate').value=dateNow();
  $('collabCopyId').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(me);message('Account ID copied. Share it only with someone you want to collaborate with.');}catch{message('Select your ID and copy it manually.');}});
  async function loadSpaces(preferred){
    const {data,error}=await client.from('daymark_spaces').select('id,name,owner_id,created_at').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    spaces=data||[];
    const current=preferred||currentSpace?.id;
    $('collabSpaceSelect').replaceChildren(new Option(spaces.length?'Choose a space':'No shared spaces yet',''));
    spaces.forEach(s=>$('collabSpaceSelect').add(new Option(`${s.name}${s.owner_id===me?' · Owned':' · Shared'}`,s.id)));
    if(current && spaces.some(s=>s.id===current))$('collabSpaceSelect').value=current;
    currentSpace=spaces.find(s=>s.id===$('collabSpaceSelect').value)||null;
    await loadCurrentSpace();
  }
  async function loadCurrentSpace(){
    currentSpace=spaces.find(s=>s.id===$('collabSpaceSelect').value)||null;
    $('collabWorkspace').hidden=!currentSpace;
    if(!currentSpace){members=[];sharedTasks=[];return;}
    const isOwner=currentSpace.owner_id===me;
    $('collabAddMemberForm').hidden=!isOwner;
    $('collabDeleteSpace').hidden=!isOwner;
    $('collabSpaceSummary').textContent=`${currentSpace.name} · ${isOwner?'You own this space':'You are an editor'}`;
    const [{data:ms,error:meError},{data:ts,error:taskError}]=await Promise.all([
      client.from('daymark_space_members').select('space_id,user_id,joined_at').eq('space_id',currentSpace.id).order('joined_at'),
      client.from('daymark_space_tasks').select('id,title,due_date,notes,completed,created_by').eq('space_id',currentSpace.id).order('due_date').limit(250)
    ]);
    if(meError)throw meError;if(taskError)throw taskError;
    members=ms||[];sharedTasks=ts||[];
    const h=document.createElement('div');h.textContent=`Space owner: ${short(currentSpace.owner_id)} · ${members.length} editor${members.length===1?'':'s'}`;
    $('collabMembers').replaceChildren(h);
    members.forEach(member=>{
      const row=document.createElement('div');row.className='collab-member';
      const code=document.createElement('code');code.textContent=member.user_id;
      row.append(code);
      const role=document.createElement('span');role.textContent=member.user_id===me?'(you)':'';row.append(role);
      if(isOwner || member.user_id===me){
        const remove=document.createElement('button');remove.type='button';remove.className='delete-button';remove.textContent=member.user_id===me?'Leave':'Remove';
        remove.addEventListener('click',()=>removeMember(member.user_id));row.append(remove);
      }
      $('collabMembers').append(row);
    });
    $('collabTasks').replaceChildren();
    if(!sharedTasks.length){const p=document.createElement('p');p.className='helper';p.textContent='No shared tasks yet. Add one above.';$('collabTasks').append(p);}
    sharedTasks.forEach(task=>{
      const row=document.createElement('div');row.className='collab-task'+(task.completed?' done':'');
      const check=document.createElement('button');check.type='button';check.className='task-check';check.textContent=task.completed?'✓':'';check.setAttribute('aria-label',`Mark ${task.title} ${task.completed?'incomplete':'complete'}`);
      check.addEventListener('click',()=>updateSharedTask(task.id,!task.completed));
      const title=document.createElement('span');title.className='collab-task-title';title.textContent=task.title;
      const date=document.createElement('time');date.textContent=formatDate(task.due_date);
      const del=document.createElement('button');del.type='button';del.className='text-button';del.textContent='Delete';del.addEventListener('click',()=>deleteSharedTask(task.id));
      row.append(check,title,date,del);$('collabTasks').append(row);
    });
  }
  async function refreshSpaces(preferred){try{await loadSpaces(preferred);message('Shared spaces are up to date.');}catch(err){message(`Could not load spaces: ${err.message}. If this is a new update, run collaboration.sql in Supabase first.`,true);}}
  $('collabOpen').addEventListener('click',()=>{$('collaborationDialog').showModal();refreshSpaces();});
  $('collabRefresh').addEventListener('click',()=>refreshSpaces());
  $('collabSpaceSelect').addEventListener('change',()=>loadCurrentSpace().then(()=>message('')).catch(e=>message(e.message,true)));
  $('collabCreateForm').addEventListener('submit',async e=>{
    e.preventDefault();const name=$('collabNewName').value.trim();if(name.length<2||name.length>70)return;
    const {data,error}=await client.from('daymark_spaces').insert({name,owner_id:me}).select('id').single();
    if(error){message(error.message,true);return;}
    $('collabNewName').value='';await refreshSpaces(data.id);
    message('Private shared space created. Add collaborators by their Daymark account IDs.');
  });
  $('collabAddMemberForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentSpace||currentSpace.owner_id!==me)return;
    const member=$('collabMemberId').value.trim();if(!validUUID(member)){message('Enter a valid Daymark account UUID.',true);return;}
    if(member===me){message('You already own this space.');return;}
    const {error}=await client.from('daymark_space_members').insert({space_id:currentSpace.id,user_id:member,added_by:me});
    if(error){message(`Could not add member: ${error.message}`,true);return;}
    $('collabMemberId').value='';await refreshSpaces(currentSpace.id);message('Member added. They can see this space when they refresh Daymark.');
  });
  async function removeMember(id){
    if(!currentSpace)return;
    if(!confirm(id===me?'Leave this shared space?':'Remove this collaborator from the shared space?'))return;
    const space=currentSpace.id;
    const {error}=await client.from('daymark_space_members').delete().eq('space_id',space).eq('user_id',id);
    if(error){message(error.message,true);return;}
    await refreshSpaces(id===me?null:space);message('Membership updated.');
  }
  $('collabDeleteSpace').addEventListener('click',async()=>{
    if(!currentSpace || currentSpace.owner_id!==me || !confirm(`Permanently delete “${currentSpace.name}” and all shared tasks?`))return;
    const id=currentSpace.id;
    const {error}=await client.from('daymark_spaces').delete().eq('id',id);
    if(error){message(error.message,true);return;}
    currentSpace=null;await refreshSpaces();message('Shared space permanently deleted.');
  });
  $('collabTaskForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentSpace)return;
    const title=$('collabTaskTitle').value.trim(),date=$('collabTaskDate').value;
    if(!title||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)){message('Enter a title and valid due date.',true);return;}
    const {error}=await client.from('daymark_space_tasks').insert({space_id:currentSpace.id,created_by:me,title,due_date:date});
    if(error){message(error.message,true);return;}
    $('collabTaskTitle').value='';await refreshSpaces(currentSpace.id);message('Shared task added.');
  });
  async function updateSharedTask(id,value){
    if(!currentSpace)return;
    const {error}=await client.from('daymark_space_tasks').update({completed:value,updated_at:new Date().toISOString()}).eq('id',id).eq('space_id',currentSpace.id);
    if(error){message(error.message,true);return;}
    await refreshSpaces(currentSpace.id);
  }
  async function deleteSharedTask(id){
    if(!currentSpace||!confirm('Delete this shared task for everyone in the space?'))return;
    const {error}=await client.from('daymark_space_tasks').delete().eq('id',id).eq('space_id',currentSpace.id);
    if(error){message(error.message,true);return;}
    await refreshSpaces(currentSpace.id);
  }
})();
