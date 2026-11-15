import{b as c,e as i,h as o,t as m}from"./ui.DG7dXUww.js";import{r as l}from"./stages.B6Cv_Pjl.js";const s=new URLSearchParams(location.search).get("id");document.getElementById("printBtn").addEventListener("click",()=>window.print());async function v(){if(!s||!/^\d+$/.test(s)){location.replace("/leads");return}try{const a=await c(`/engagements/${s}`),t=a.item,e=a.firm||{};document.getElementById("backTo").href=`/engagement?id=${t.id}`,document.title=`${t.estimate_no||"Estimate"} · ${t.display_name}`;const n=[t.client_address,[t.client_city,t.client_state,t.client_pincode].filter(Boolean).join(", ")].filter(Boolean).join(`
`);document.getElementById("paper").innerHTML=`
        <div class="top">
          <div class="firm"><b>${i(e.firm_name||"")}</b>
            <span>${i(e.firm_tagline||"")}</span>
            ${e.firm_address?`<span>${i(e.firm_address)}</span>`:""}
            <span>${i([e.firm_phone,e.firm_email].filter(Boolean).join(" · "))}</span>
            ${e.firm_gstin?`<span>GSTIN: ${i(e.firm_gstin)}</span>`:""}
          </div>
          <div class="doc"><h1>ESTIMATE</h1>
            <div>No. <b>${i(t.estimate_no||"Draft")}</b></div>
            <div>Date <b>${i(t.estimate_date?o(t.estimate_date):"—")}</b></div>
            ${t.estimate_valid_until?`<div>Valid until <b>${i(o(t.estimate_valid_until))}</b></div>`:""}
          </div>
        </div>
        <div class="to">
          <div><div class="label">Estimate for</div><b>${i(t.display_name)}</b>
            ${n?`<span>${i(n)}</span>`:""}
            ${t.client_gstin?`<span>GSTIN: ${i(t.client_gstin)}</span>`:""}
            ${t.contact?`<span>${i(t.contact)}</span>`:""}
          </div>
          <div><div class="label">Assignment</div><span>${i(t.service)}</span></div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Description</th><th>Amount (₹)</th></tr></thead>
          <tbody>
            ${a.items.map((d,r)=>`<tr><td class="n">${r+1}</td><td>${i(d.description)}</td><td>${i(l(d.amount))}</td></tr>`).join("")}
            <tr class="total"><td></td><td>Total (before GST)</td><td>${i(l(a.total))}</td></tr>
          </tbody>
        </table>
        ${t.estimate_notes?`<div class="notes"><div class="label">Notes</div>${i(t.estimate_notes)}</div>`:""}
        <div class="sign"><div><div class="for">For ${i(e.firm_name||"")}</div><div class="sig">Authorised signatory</div></div></div>
        <div class="foot">This is an estimate, not a tax invoice.</div>`}catch(a){m(a)}}v();
