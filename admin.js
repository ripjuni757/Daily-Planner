/* Solenary v7 admin page. The database, not this client, decides admin access. */
'use strict';
(async function() {
  const client=window.daymarkClient;
  const byId=id=>document.getElementById(id);
  const state=byId('adminState'), content=byId('adminContent');
  if(!client){state.textContent='Supabase configuration is missing.';state.className='admin-state error';return;}
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user){location.replace('login.html');return;}
  const {data:isAdmin,error:adminError}=await client.rpc('solenary_am_i_admin');
  if(adminError){state.textContent='Admin setup is incomplete. Run admin-feedback.sql in Supabase, then promote your account using SET-ADMIN.sql.';state.className='admin-state error';return;}
  if(isAdmin!==true){state.textContent='Access denied. Your account does not have administrator privileges.';state.className='admin-state error';return;}
  let feedback=[];
  function render() {
    const filter=byId('adminFeedbackFilter').value;
    const shown=feedback.filter(f=>filter==='all'||f.status===filter);
    const list=byId('adminFeedbackList');list.replaceChildren();
    if(!shown.length){const empty=document.createElement('div');empty.className='admin-empty';empty.textContent='No feedback matching this filter.';list.append(empty);return;}
    for(const row of shown){
      const item=document.createElement('article');item.className='admin-feedback-item';
      const top=document.createElement('div');top.className='admin-feedback-top';
      const category=document.createElement('span');category.className='admin-category';category.textContent=({idea:'Feature idea',bug:'Bug report',design:'Design suggestion',other:'Other'})[row.category]||'Other';
      const time=document.createElement('time');time.className='admin-meta';time.dateTime=row.created_at;time.textContent=new Date(row.created_at).toLocaleString();top.append(category,time);
      const message=document.createElement('p');message.className='admin-feedback-message';message.textContent=row.message;
      const bottom=document.createElement('div');bottom.className='admin-feedback-bottom';
      const account=document.createElement('span');account.className='admin-user';account.textContent=`Account ID: ${row.user_id}`;
      const label=document.createElement('label');label.textContent='Status';
      const select=document.createElement('select');select.setAttribute('aria-label','Feedback status');
      for(const opt of ['new','reviewed','resolved']){const option=document.createElement('option');option.value=opt;option.textContent=opt[0].toUpperCase()+opt.slice(1);select.append(option);}
      select.value=row.status;
      select.addEventListener('change',async()=>{
        select.disabled=true;const wanted=select.value;
        const {error}=await client.from('solenary_feedback').update({status:wanted}).eq('id',row.id);
        if(error){select.value=row.status;state.textContent='Could not update feedback: '+error.message;state.className='admin-state error';}else{row.status=wanted;state.textContent='Feedback updated.';state.className='admin-state';await refreshStats();}
        select.disabled=false;
      });
      label.append(select);bottom.append(account,label);item.append(top,message,bottom);list.append(item);
    }
  }
  async function refreshStats(){
    const {data,error}=await client.rpc('solenary_admin_stats');
    if(error)throw error;
    byId('adminUserCount').textContent=Number(data.total_users).toLocaleString();
    byId('adminFeedbackCount').textContent=Number(data.total_feedback).toLocaleString();
    byId('adminNewCount').textContent=Number(data.new_feedback).toLocaleString();
  }
  async function refresh(){
    state.textContent='Loading statistics and feedback…';state.className='admin-state';
    try{
      await refreshStats();
      const {data,error}=await client.from('solenary_feedback').select('id,user_id,category,message,status,created_at').order('created_at',{ascending:false}).limit(200);
      if(error)throw error; feedback=data||[];render();content.hidden=false;
      state.textContent='Dashboard updated. Feedback is visible only to authorized admins.';
    }catch(err){state.textContent='Could not load admin dashboard: '+err.message;state.className='admin-state error';}
  }
  byId('adminRefresh').addEventListener('click',refresh);
  byId('adminFeedbackFilter').addEventListener('change',render);
  // Admin-only User Analytics. Server RPCs also verify the account's admin role.
  const feedbackTab=byId('adminTabFeedback');
  const usersTab=byId('adminTabUsers');
  const feedbackPanel=byId('adminFeedbackPanel');
  const usersPanel=byId('adminUsersPanel');
  const usersState=byId('adminUsersState');
  const usersBody=byId('adminUsersBody');
  const usersSearch=byId('adminUserSearch');
  const pageSize=30;
  let currentPage=0, hasNext=false, loadedUsers=false, requestSeq=0, searchTimer=null;

  const formatStamp=v=>v?new Date(v).toLocaleString(): 'Never';
  function cell(tr,value){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}
  function setUserState(message,error=false){usersState.textContent=message;usersState.classList.toggle('error',error);}
  function updatePagination(){
    byId('adminUsersPrev').disabled=currentPage<=0;
    byId('adminUsersNext').disabled=!hasNext;
    byId('adminUsersPage').textContent=`Page ${currentPage+1}`;
  }
  async function loadUsers(){
    const req=++requestSeq;
    setUserState('Loading registered users and activity…');
    try {
      const [userResult,summaryResult]=await Promise.all([
        client.rpc('solenary_admin_users',{p_limit:pageSize+1,p_offset:pageSize*currentPage,p_search:usersSearch.value.trim()}),
        client.rpc('solenary_admin_usage_overview')
      ]);
      if(req!==requestSeq)return;
      if(userResult.error)throw userResult.error;
      if(summaryResult.error)throw summaryResult.error;
      const rows=Array.isArray(userResult.data)?userResult.data:[];
      hasNext=rows.length>pageSize;
      usersBody.replaceChildren();
      for(const person of rows.slice(0,pageSize)){
        const tr=document.createElement('tr');
        cell(tr,person.email||'(no email)');
        cell(tr,formatStamp(person.registered_at));
        cell(tr,formatStamp(person.last_sign_in_at));
        cell(tr,person.last_usage_date||'Not yet');
        cell(tr,Number(person.minutes_7d||0).toLocaleString());
        cell(tr,Number(person.minutes_total||0).toLocaleString());
        usersBody.append(tr);
      }
      if(!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=6;td.textContent='No registered users match this search.';tr.append(td);usersBody.append(tr);}
      const overview=summaryResult.data||{};
      byId('adminActive7').textContent=Number(overview.active_users_7d||0).toLocaleString();
      byId('adminMinutes7').textContent=Number(overview.minutes_7d||0).toLocaleString();
      byId('adminMinutesAll').textContent=Number(overview.minutes_total||0).toLocaleString();
      updatePagination();
      loadedUsers=true;
      setUserState(`Showing ${Math.min(rows.length,pageSize)} account${rows.length===1?'':'s'} on this page. Usage starts when v8 tracking is installed.`);
    } catch(err){if(req!==requestSeq)return;setUserState('Unable to load users. Run usage-analytics.sql in Supabase and confirm your admin account. '+(err?.message||''),true);}
  }
  function selectPanel(which){
    const users=which==='users';
    feedbackTab.classList.toggle('is-active',!users);
    usersTab.classList.toggle('is-active',users);
    feedbackTab.setAttribute('aria-selected',String(!users));
    usersTab.setAttribute('aria-selected',String(users));
    feedbackPanel.hidden=users;
    usersPanel.hidden=!users;
    if(users&&!loadedUsers)loadUsers();
  }
  feedbackTab.addEventListener('click',()=>selectPanel('feedback'));
  usersTab.addEventListener('click',()=>selectPanel('users'));
  byId('adminUsersRefresh').addEventListener('click',loadUsers);
  byId('adminUsersPrev').addEventListener('click',()=>{if(currentPage>0){currentPage--;loadUsers();}});
  byId('adminUsersNext').addEventListener('click',()=>{if(hasNext){currentPage++;loadUsers();}});
  usersSearch.addEventListener('input',()=>{
    window.clearTimeout(searchTimer);
    currentPage=0;
    searchTimer=window.setTimeout(loadUsers,280);
  });
  await refresh();
})();
