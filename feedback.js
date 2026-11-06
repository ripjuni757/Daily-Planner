/* Solenary v7: private feedback submission + admin navigation discovery. */
'use strict';
(async function() {
  const form = document.getElementById('feedbackForm');
  const adminLink = document.getElementById('adminNav');
  const client = window.daymarkClient;
  if (!client) return;
  try {
    const {data:{user},error} = await client.auth.getUser();
    if (error || !user) return;
    // Hiding this link is cosmetic only. admin.html and SQL verify the role again.
    const {data:admin,error:roleError} = await client.rpc('solenary_am_i_admin');
    if (!roleError && admin === true && adminLink) adminLink.hidden = false;
    if (!form) return;
    const status = document.getElementById('feedbackStatus');
    const submit = document.getElementById('feedbackSubmit');
    form.addEventListener('submit',async (e)=>{
      e.preventDefault();
      const message = document.getElementById('feedbackMessage').value.trim();
      const category = document.getElementById('feedbackCategory').value;
      if (message.length < 10 || message.length > 2000) {
        status.textContent='Please enter between 10 and 2,000 characters.';
        status.className='feedback-status error';return;
      }
      if (!['idea','bug','design','other'].includes(category)) return;
      submit.disabled=true;
      status.textContent='Sending…';status.className='feedback-status';
      try {
        const {error:sendError} = await client.from('solenary_feedback').insert({user_id:user.id,category,message});
        if (sendError) throw sendError;
        status.textContent='Thank you — your feedback has been submitted.';
        status.className='feedback-status success';
        form.reset();
      } catch(err) {
        status.textContent=String(err.code)==='42P01'?'Feedback is not configured yet. Please run admin-feedback.sql in Supabase.':String(err.code)==='P0001'?'Please wait before submitting more feedback.':'Unable to send feedback. Please try again.';
        status.className='feedback-status error';
        console.warn('Solenary feedback submission failed:',err.code || err.message);
      } finally {submit.disabled=false;}
    });
  } catch(err) { console.warn('Solenary feedback unavailable:',err.message); }
})();
