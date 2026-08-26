const ORDER=['CONFORMS','VIOLATION','UNCHECKABLE','NOT_DELIVERED','PAYMENT_REJECTED','UNPAYABLE'];
const LABEL={CONFORMS:'Conforms',VIOLATION:'Violation',UNCHECKABLE:'Uncheckable',NOT_DELIVERED:'Not delivered',PAYMENT_REJECTED:'Payment rejected',UNPAYABLE:'Unpayable'};
const money=v=>v==null?'—':'$'+v.toFixed(v<0.01?6:3).replace(/0+$/,'').replace(/\.$/,'');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

fetch('data.json').then(r=>r.json()).then(rows=>{
  rows.sort((a,b)=>ORDER.indexOf(a.verdict)-ORDER.indexOf(b.verdict)||(b.settledAmount??0)-(a.settledAmount??0));
  const counts={};rows.forEach(r=>counts[r.verdict]=(counts[r.verdict]??0)+1);
  const fEl=document.getElementById('filters');
  const mk=(key,label,count)=>{
    const b=document.createElement('button');
    b.className='chip';b.dataset.key=key;b.setAttribute('aria-pressed',key==='ALL');
    b.innerHTML=esc(label)+'<span class="ct">'+count+'</span>';
    b.onclick=()=>{fEl.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');render(key);};
    fEl.appendChild(b);
  };
  mk('ALL','All',rows.length);
  ORDER.filter(v=>counts[v]).forEach(v=>mk(v,LABEL[v],counts[v]));

  const rEl=document.getElementById('rows');
  function render(filter){
    rEl.innerHTML='';
    rows.filter(r=>filter==='ALL'||r.verdict===filter).forEach(r=>{
      const u=new URL(r.url);
      const tagClass=['CONFORMS','VIOLATION','UNCHECKABLE'].includes(r.verdict)?r.verdict:'other';
      const d=document.createElement('details');d.className='row';
      const rows_=[];
      const kv=(k,v,cls)=>{if(v!=null&&v!=='')rows_.push('<dt>'+k+'</dt><dd'+(cls?' class="'+cls+'"':'')+'>'+v+'</dd>')};
      kv('Verdict detail',esc(r.detail??''),'note');
      if(r.nesting)kv('Shape note','<span class="warn">'+esc(r.nesting)+'</span>','note');
      kv('Contract source',esc(r.contractKind??'—'));
      if(r.declaredFields.length)kv('Declared fields',esc(r.declaredFields.join('  ')));
      if(r.extraKeys.length)kv('Undeclared keys returned',esc(r.extraKeys.join('  ')));
      kv('Quoted price',money(r.livePrice));
      kv('Settled on-chain',r.settledAmount==null?(r.settlementAttribution&&r.settlementAttribution.startsWith('UNDETERMINED')?'<span class="warn">undetermined, no claim made</span>':'—'):(r.settledAmount===0?'<span class="good">$0, not charged</span>':money(r.settledAmount)));
      if(r.settlementTx)kv('Settlement tx','<a href="https://basescan.org/tx/'+esc(r.settlementTx)+'">'+esc(r.settlementTx.slice(0,22))+'…</a>');
      kv('HTTP status',r.httpStatus??'—');
      kv('x402 version',r.x402Version?'v'+r.x402Version:'—');
      if(r.retried)kv('History','<span class="retried">first attempt rejected under the legacy X-PAYMENT header name; accepted on retry with PAYMENT-SIGNATURE</span>','note');
      if(r.body)kv('Response body',esc(r.body));
      d.innerHTML='<summary>'
        +'<span class="host">'+esc(u.host)+'<span class="path">'+esc(u.pathname)+'</span></span>'
        +'<span class="price">'+money(r.livePrice)+'</span>'
        +'<span class="tag '+tagClass+'">'+esc(r.verdict.replace(/_/g,' '))+'</span>'
        +'</summary><div class="row-body"><dl class="kv">'+rows_.join('')+'</dl></div>';
      rEl.appendChild(d);
    });
  }
  render('ALL');
}).catch(()=>{
  document.getElementById('rows').innerHTML='<div style="padding:20px;font-family:var(--mono);font-size:13px">Could not load data.json. The raw evidence lives in the repo at evidence/results.json.</div>';
});
