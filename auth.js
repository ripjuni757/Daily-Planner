"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const client = window.daymarkClient;
  const message=(text,error=false) => {
    const p=$('authMessage');p.textContent=text;p.hidden=!text;
    p.classList.toggle('is-error',error);
  };
  let mode='login',busy=false,recovering=window.location.hash.includes('type=recovery');
  const setMode = next => {
    mode=next;message('');
    $('authTitle').textContent=next==='signup'?'Create your account':'Sign in to your account';
    $('authSubtitle').textContent=next==='signup'?'Start with a private calendar of your own.':'Your schedule, exactly where you left it.';
    $('authSubmit').textContent=next==='signup'?'Create my Solenary':'Log in to Solenary';
    $('confirmPasswordGroup').hidden=next!=='signup';
    $('authConfirm').required=next==='signup';
    $('authPassword').setAttribute('autocomplete',next==='signup'?'new-password':'current-password');
    $('authPassword').minLength=next==='signup'?12:8;
    $('authPassword').placeholder=next==='signup'?'At least 12 characters':'Your password';
    $('forgotButton').hidden=next==='signup';
    for(const name of ['login','signup']){
      const btn=$(name+'Tab');btn.classList.toggle('active',next===name);btn.setAttribute('aria-pressed',String(next===name));
    }
  };
  const setBusy = value => {busy=value;$('authSubmit').disabled=value;$('recoverySubmit').disabled=value;};
  if(!client){
    $('authForm').hidden=true;$('authTabs').hidden=true;
    $('authSubtitle').textContent='This website has not been connected to Supabase yet.';
    message('Owner setup needed: fill out supabase-config.js and run supabase.sql. See README.md.',true);
    return;
  }
  const showRecovery = () => {
    recovering=true;
    $('authTabs').hidden=true;$('authForm').hidden=true;$('recoveryForm').hidden=false;
    $('authTitle').textContent='Set a new password';
    $('authSubtitle').textContent='Choose a secure password for your account.';
  };
  if(recovering)showRecovery();
  $('loginTab').addEventListener('click',()=>setMode('login'));
  $('signupTab').addEventListener('click',()=>setMode('signup'));
  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(mode==='signup' && password.length<12){message('Use at least 12 characters for a new password.',true);return;}
    if(mode==='signup' && password!==$('authConfirm').value){message('The passwords do not match.',true);return;}
    setBusy(true);message('');
    try {
      if(mode==='signup'){
        const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:new URL('login.html',location.href).href}});
        if(error)throw error;
        if(data.session){location.replace('index.html');return;}
        $('authPassword').value='';$('authConfirm').value='';
        message('Check your inbox for a confirmation link, then return to log in.');
      } else {
        const {error}=await client.auth.signInWithPassword({email,password});
        if(error)throw error;
        location.replace('index.html');
      }
    } catch(err){message(err.message||'Could not complete that request.',true);}
    finally{setBusy(false);}
  });
  $('forgotButton').addEventListener('click',async()=>{
    const email=$('authEmail').value.trim();
    if(!email){message('Enter your email address first, then select Forgot your password.',true);$('authEmail').focus();return;}
    if(busy)return;
    setBusy(true);
    try {
      const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:new URL('login.html',location.href).href});
      if(error)throw error;
      message('If that email has an account, a password-reset link will arrive in your inbox.');
    } catch(err){message(err.message||'Could not send reset email.',true);}
    finally{setBusy(false);}
  });
  $('recoveryForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    setBusy(true);message('');
    try {
      const {error}=await client.auth.updateUser({password:$('newPassword').value});
      if(error)throw error;
      location.replace('index.html');
    } catch(err){message(err.message||'Could not update password.',true);}
    finally{setBusy(false);}
  });
  client.auth.onAuthStateChange((event)=>{
    if(event==='PASSWORD_RECOVERY')showRecovery();
  });
  try {
    const {data,error}=await client.auth.getUser();
    if(!error && data?.user && !recovering) location.replace('index.html');
  } catch (_) {
    message('Could not reach Supabase right now. Check your connection and try again.',true);
  }
})();
