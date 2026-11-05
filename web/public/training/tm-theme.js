(()=>{
 function apply(){let theme;try{theme=localStorage.getItem('tm_theme')}catch{}theme=theme==='dark'||theme==='light'?theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('tm-theme-change'));}
 apply();addEventListener('storage',e=>{if(e.key==='tm_theme')apply()});matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);
 document.querySelectorAll('[data-tm-page]').forEach(a=>a.addEventListener('click',e=>{if(parent!==window){e.preventDefault();parent.postMessage({type:'tm-training-navigate',page:a.dataset.tmPage},location.origin)}}));
 if(parent!==window)document.documentElement.classList.add('embedded');
})();
