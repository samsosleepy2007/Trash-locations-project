// Public client configuration only. Never put service_role, SMTP or Resend secrets here.
// Set enabled=true only after backend, university email delivery and admin access pass verification.
window.ACTIVITY_CONFIG = Object.freeze({
  enabled: false,
  supabaseUrl: '',
  publishableKey: ''
});
