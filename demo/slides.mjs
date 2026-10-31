// Three full-screen slides used between and after the live footage. Plain HTML, no external assets.
const base = `
  <style>
    html,body{margin:0;height:100%;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;background:#f6f5f0;color:#12201c}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 160px;box-sizing:border-box}
    .mark{width:72px;height:72px;border-radius:16px;background:#14705a;color:#fff;font-size:44px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:28px}
    h1{font-size:92px;margin:0 0 20px;letter-spacing:-1px}
    h2{font-size:54px;margin:0 0 48px;line-height:1.15}
    p{font-size:34px;color:#55605b;margin:0;line-height:1.45}
    .row{display:flex;gap:56px;margin-bottom:40px}
    .card{flex:1;background:#fff;border:2px solid #dcd9cf;border-radius:28px;padding:40px 48px}
    .big{font-size:96px;font-weight:700;margin:12px 0 8px}
    .good{color:#14705a}.bad{color:#c4122f}
    .small{font-size:28px;color:#55605b}
    li{font-size:36px;line-height:1.7;margin-left:8px}
    code{background:#e3f1ec;padding:2px 10px;border-radius:8px;font-size:32px}
  </style>`;
export const title = `${base}<div class="wrap"><div class="mark">A</div><h1>Allowance</h1><p>Spending mandates and human approval for AI shopping agents</p><p class="small" style="margin-top:40px">PayPal AI Hackathon &middot; PayPal sandbox only, no real money</p></div>`;
export const ablation = `${base}<div class="wrap"><h2>Same agent, same errands, policy engine on and off</h2>
  <div class="row"><div class="card"><p>Policy engine on</p><div class="big good">$53.98</div><p class="small">authorized on PayPal with no person involved</p></div>
  <div class="card"><p>Policy engine off</p><div class="big bad">$27,870.73</div><p class="small">authorized with no person involved</p></div></div>
  <p class="small">The unguarded agent authorized a $27,375.00 luxury watch and a $262.73 jacket. The guarded agent had both denied, then proposed cheaper alternatives. Full table in docs/ablation.md.</p></div>`;
export const closing = `${base}<div class="wrap"><h2>What this demo does and does not show</h2><ul>
  <li>Funding: a PayPal sandbox test card</li>
  <li>Wallet approval at PayPal: implemented, not exercised</li>
  <li>Built with PayPal Orders v2, AG Studio, Channel3, Fireworks (gpt-oss-120b)</li>
  <li>Hosted demo: <code>allowance-paypal-agents.vercel.app</code></li>
  <li>Open source, MIT: <code>github.com/rishabhcli/allowance-paypal-agents</code></li></ul></div>`;

export const flow = `${base}<style>.steps{display:flex;align-items:stretch;gap:20px;margin-bottom:48px}.step{flex:1;background:#fff;border:2px solid #dcd9cf;border-radius:24px;padding:28px 26px}.step b{display:block;font-size:34px;margin-bottom:10px}.step span{font-size:25px;color:#55605b;line-height:1.35}.arrow{align-self:center;font-size:44px;color:#14705a}.chips{display:flex;gap:24px}.chip{flex:1;border-radius:20px;padding:22px 28px;font-size:28px;line-height:1.3}.ok{background:#e3f1ec;color:#0d4d3e}.wait{background:#fdf1d6;color:#8a5a00}.no{background:#fbe3e6;color:#9b0f26}</style>
<div class="wrap"><h2>How a purchase flows</h2><div class="steps">
<div class="step"><b>Errand</b><span>Plain words from a person</span></div><div class="arrow">&rarr;</div>
<div class="step"><b>Agent</b><span>Fireworks model, products from Channel3</span></div><div class="arrow">&rarr;</div>
<div class="step"><b>Policy engine</b><span>Mandate limits, no model involved</span></div><div class="arrow">&rarr;</div>
<div class="step"><b>PayPal</b><span>Orders v2, authorize first</span></div><div class="arrow">&rarr;</div>
<div class="step"><b>Person</b><span>Capture, lower final price, or void</span></div></div>
<div class="chips"><div class="chip ok">Inside every limit: approved, hold placed</div><div class="chip wait">Above what the agent may spend alone: waits for a person</div><div class="chip no">Outside the mandate: denied before PayPal is called</div></div></div>`;
