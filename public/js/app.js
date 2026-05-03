document.querySelector('[data-menu-toggle]')?.addEventListener('click',()=>document.querySelector('[data-menu]')?.classList.toggle('open'));
document.querySelectorAll('[data-toast]').forEach(btn=>btn.addEventListener('click',()=>toast(btn.dataset.toast)));
function toast(msg){const t=document.createElement('div');t.textContent=msg;t.style='position:fixed;right:20px;bottom:20px;background:#c8102e;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 12px 25px rgba(0,0,0,.2);z-index:9999;font-weight:800';document.body.appendChild(t);setTimeout(()=>t.remove(),2500)}
