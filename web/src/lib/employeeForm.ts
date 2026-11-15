import { openSheet, copyText } from './ui';

/** Admins cannot assign the Owner role. */
export function limitRoles(form: HTMLFormElement, myRole: string, currentRole?: string) {
  const owner = form.querySelector<HTMLOptionElement>('option[data-owner-only]');
  if (owner) owner.hidden = owner.disabled = myRole !== 'owner' && currentRole !== 'owner';
}

export function showTempPassword(name: string, email: string, password: string) {
  const sheet = document.getElementById('pwSheet') as HTMLDialogElement;
  (document.getElementById('pwIntro') as HTMLElement).innerHTML = '';
  const intro = document.getElementById('pwIntro') as HTMLElement;
  intro.textContent = `${name} can now sign in with ${email} and this password:`;
  (document.getElementById('pwValue') as HTMLElement).textContent = password;
  const copy = document.getElementById('pwCopy') as HTMLButtonElement;
  copy.onclick = () => copyText(password);
  openSheet(sheet);
}
