window.setupLogin = function setupLogin(onSubmit) {
 const form = document.querySelector('#login-form');
 const username = form.elements.username;
 const password = form.elements.password;
 const toggle = form.querySelector('#password-toggle');
 const error = form.querySelector('#login-error');
 const errorText = error.querySelector('[data-login-error-text]');
 const button = form.querySelector('[data-login-submit]');
 const buttonLabel = button.querySelector('[data-login-button-label]');
 const buttonIcon = button.querySelector('[data-login-button-icon]');
 let processing = false;

 function clearError() {
  error.hidden = true;
  errorText.textContent = '';
  username.removeAttribute('aria-invalid');
  password.removeAttribute('aria-invalid');
 }
 function showError(message, invalidField) {
  errorText.textContent = message;
  error.hidden = false;
  if (invalidField) {
   invalidField.setAttribute('aria-invalid', 'true');
   invalidField.focus();
  }
 }
 function setProcessing(value) {
  processing = value;
  button.disabled = value;
  form.setAttribute('aria-busy', String(value));
  buttonLabel.textContent = value ? 'Signing in...' : 'Sign in';
  buttonIcon.classList.toggle('login-spinner', value);
  buttonIcon.textContent = value ? '' : '→';
  username.readOnly = value;
  password.readOnly = value;
 }

 toggle.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(visible));
  password.focus();
 });
 username.addEventListener('input', clearError);
 password.addEventListener('input', clearError);
 form.addEventListener('submit', async event => {
  event.preventDefault();
  if (processing) return;
  clearError();
  if (!username.value.trim()) return showError('Please enter your username.', username);
  if (!password.value) return showError('Please enter your password.', password);
  setProcessing(true);
  try {
   await onSubmit({username: username.value.trim(), password: password.value});
   password.value = '';
   password.type = 'password';
   toggle.setAttribute('aria-label', 'Show password');
   toggle.setAttribute('aria-pressed', 'false');
  } catch (failure) {
   const message = failure.status === 401 ? 'Incorrect username or password. Please try again.'
    : failure.status === 429 ? 'Too many attempts. Try again in 15 minutes.'
    : 'Unable to sign in right now. Please try again shortly.';
   showError(message);
  } finally {
   setProcessing(false);
  }
 });
};
