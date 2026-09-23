/* Utility bill adapter. Static GitHub Pages cannot bypass official portal sessions/CAPTCHA.
   Configure an approved API/backend in Settings. Expected response may include:
   {consumerName, tariffCategory, sanctionedLoadKW, connectedLoadKW, latestUnits,
    latestBillAmount, billDate, meterNumber, billingCycle,
    monthlyHistory:[{period,units,billAmount,periodMonths:1}, ...]}
*/
window.SolarApp = window.SolarApp || {};
SolarApp.Utility = (function () {
  const OFFICIAL_PORTAL = 'https://www.tnpdcl.gov.in/';
  function normalizeConsumerNumber(v){ return String(v||'').trim().replace(/\s+/g,''); }
  function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

  function normalizeHistory(list){
    if(!Array.isArray(list)) return [];
    return list.map((r,i)=>{
      const months=Math.max(1,num(r.periodMonths ?? r.months ?? 1)||1);
      const units=num(r.units ?? r.kWh ?? r.consumptionUnits ?? r.monthlyUnits);
      const bill=num(r.billAmount ?? r.amount ?? r.bill);
      return {
        period: String(r.period ?? r.billingPeriod ?? r.month ?? `Period ${i+1}`),
        periodMonths: months,
        monthlyUnits: units===null?null:units/months,
        monthlyBill: bill===null?null:bill/months,
        rawUnits: units,
        rawBill: bill
      };
    }).filter(r=>r.monthlyUnits!==null || r.monthlyBill!==null);
  }

  function setFields(d){
    const map={
      utilityConsumerName:d.consumerName ?? d.name,
      utilityTariffCategory:d.tariffCategory ?? d.tariff,
      utilitySanctionedLoad:d.sanctionedLoadKW ?? d.sanctionedLoad,
      utilityConnectedLoad:d.connectedLoadKW ?? d.connectedLoad,
      utilityLatestUnits:d.latestUnits ?? d.units,
      utilityLatestBill:d.latestBillAmount ?? d.billAmount,
      utilityBillDate:d.billDate,
      utilityMeterNumber:d.meterNumber,
      utilityBillingCycle:d.billingCycle
    };
    Object.entries(map).forEach(([id,v])=>{const el=document.getElementById(id);if(el&&v!==undefined&&v!==null)el.value=v;});
    const history=normalizeHistory(d.monthlyHistory ?? d.billHistory ?? d.history ?? d.bills);
    const units=history.length?history.reduce((s,r)=>s+(r.monthlyUnits||0),0)/history.filter(r=>r.monthlyUnits!==null).length:Number(d.latestUnits ?? d.units);
    const load=Number(d.sanctionedLoadKW ?? d.sanctionedLoad);
    const bill=history.length?history.reduce((s,r)=>s+(r.monthlyBill||0),0)/history.filter(r=>r.monthlyBill!==null).length:Number(d.latestBillAmount ?? d.billAmount);
    if(Number.isFinite(units)&&units>0){const el=document.getElementById('avgMonthlyUnits');if(el)el.value=Math.round(units*100)/100;}
    if(Number.isFinite(load)&&load>0){const el=document.getElementById('sanctionedLoad');if(el)el.value=load;}
    if(Number.isFinite(bill)&&bill>0){const el=document.getElementById('currentBillInput');if(el)el.value=Math.round(bill*100)/100;}
    if(d.consumerName){const el=document.getElementById('custName');if(el&&!el.value)el.value=d.consumerName;}
    return history;
  }

  function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

  async function fetchTnebBill({username,password,consumerNumber}){
    const number=normalizeConsumerNumber(consumerNumber);
    if(!username||!password||!number)throw new Error('Enter TNEB username, password and consumer/service number.');
    const cfg=(SolarApp.Config.get().utility||{});
    const endpoint=String(cfg.billApiUrl||'/api/tneb-fetch').trim() || '/api/tneb-fetch';
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'include',body:JSON.stringify({username,password,consumerNumber:number})});
    let data=null; try{data=await res.json();}catch(e){}
    if(!res.ok)throw new Error(data?.error||`Bill backend returned HTTP ${res.status}`);
    if(!data||typeof data!=='object')throw new Error('Bill backend returned invalid JSON.');
    return data;
  }

  async function fetchDetails(consumerNumber){
    throw new Error('Use fetchTnebBill({ username, password, consumerNumber }) for the secure login flow.');
  }
  function simulateHistory(consumerNumber, baseUnits=750){
    const seed=String(consumerNumber||'DEMO').split('').reduce((a,c)=>((a*31)+c.charCodeAt(0))>>>0,7);
    const rows=[]; const now=new Date();
    for(let i=9;i>=0;i--){
      const seasonal=1 + 0.12*Math.sin((i+seed%10)/1.7);
      const noise=((seed + i*97)%101 - 50)/500;
      const units=Math.max(0,Math.round(Number(baseUnits||750)*seasonal*(1+noise)));
      const bill=Math.round(SolarApp.Pricing.billFromUnits(units,SolarApp.Config.get().tariff));
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      rows.push({period:d.toLocaleString('en-IN',{month:'short',year:'numeric'}),units,billAmount:bill,periodMonths:1});
    }
    return normalizeHistory(rows);
  }
  function openOfficialPortal(){window.open(OFFICIAL_PORTAL,'_blank','noopener,noreferrer');}
  return {fetchDetails,fetchTnebBill,setFields,normalizeConsumerNumber,normalizeHistory,escapeHtml,openOfficialPortal,OFFICIAL_PORTAL};
})();
