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
  await refresh();
})();
