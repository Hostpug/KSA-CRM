import{r as c}from"./Layout.astro_astro_type_script_index_0_lang.BXmJ9tg2.js";import{r as p,m as g,b as m,n as f,p as y,l as u,o as b,e as n,w as v,R as E,c as h,f as $,q as w,t as L}from"./ui.DG7dXUww.js";import{s as B,l as I}from"./employeeForm.BrC0k3xH.js";const o=document.getElementById("people"),d=document.getElementById("empSheet"),s=document.getElementById("empForm");let i="staff";const _=a=>`<span class="badge ${a==="owner"?"green":a==="admin"?"blue":""}">${E[a]}</span>`;async function l(){try{const a=await m("/employees");o.innerHTML=a.items.length?a.items.map(e=>`
        <a class="card person ${e.active?"":"off"}" href="/member?id=${e.id}">
          <span class="avatar lg">${n(v(e.name))}</span>
          <span class="who">
            <b>${n(e.name)}</b>
            <span class="s">${n(e.designation||e.email)}</span>
            <span class="badges">${_(e.role)}
              ${e.active?e.locked?'<span class="badge red">Locked</span>':e.must_change_pw?'<span class="badge amber">Invite pending</span>':"":'<span class="badge">Inactive</span>'}
            </span>
            <span class="s">${e.last_login_at?`Last sign-in ${n(h(e.last_login_at))}`:"Never signed in"}</span>
          </span>
        </a>`).join(""):$("team","No employees yet"),w(o)}catch(a){L(a)}}function r(){s.reset(),I(s,i),u(s,{role:"staff"}),b(d)}document.getElementById("addEmp").addEventListener("click",r);document.getElementById("fab").addEventListener("click",r);s.addEventListener("submit",async a=>{a.preventDefault();const e=p(s);delete e.active;const t=await g(s,document.getElementById("empSave"),()=>m("/employees",{method:"POST",body:e}));t&&(f(d),y(`${t.item.name} added`),setTimeout(()=>B(t.item.name,t.item.email,t.tempPassword),260),l())});c.then(a=>{i=a.user.role,l()});
