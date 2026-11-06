// The browser-side Supabase client. Auth and row-level security protect user data.
(function(){
  const c=window.DAYMARK_CONFIG;
  if(!window.supabase || !c || !/^https:\/\//.test(c.url) || !c.publishableKey || c.publishableKey.startsWith('YOUR_')) {
    window.daymarkClient=null;
    return;
  }
  window.daymarkClient=window.supabase.createClient(c.url,c.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
})();
