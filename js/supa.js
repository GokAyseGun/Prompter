import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// ERP ile aynı adreste (gokaysegun.github.io) çalıştığı için oturum ayrı anahtarda tutulur:
// Prompter'dan çıkış yapmak ERP oturumunu etkilemez.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'prompter-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  db: { schema: 'prompter' },
});

export async function getUser(){
  const { data } = await sb.auth.getSession();
  return data?.session?.user || null;
}

/* Basit giriş ekranı: #login öğesini doldurur, giriş olunca resolve eder */
export function loginGate(root, defaultEmail){
  return new Promise(async resolve => {
    const u = await getUser();
    if (u) { resolve(u); return; }
    root.hidden = false;
    root.innerHTML = `<form class="login-box" autocomplete="on">
        <div class="brand big"><span class="dot"></span>Aynalı Prompter</div>
        <p class="muted">Devam etmek için giriş yapın.</p>
        <label class="lf"><span>E-posta</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="lf"><span>Şifre</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p class="err" hidden></p>
        <button class="btn primary wide" type="submit">Giriş yap</button>
      </form>`;
    const f = root.querySelector('form'), err = root.querySelector('.err');
    f.email.value = defaultEmail || '';
    (defaultEmail ? f.password : f.email).focus();
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Giriş yapılıyor…';
      const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      btn.disabled = false; btn.textContent = 'Giriş yap';
      if (error) {
        err.textContent = /invalid/i.test(error.message) ? 'E-posta veya şifre hatalı.' : (navigator.onLine ? error.message : 'İnternet bağlantısı yok.');
        err.hidden = false; return;
      }
      root.hidden = true; root.innerHTML = '';
      resolve(data.user);
    });
  });
}
