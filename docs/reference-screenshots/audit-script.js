const { chromium } = require('playwright');
const SITE='https://velora-sales-inventory.sujankarki15357.chatgpt.site/';
const out=process.argv[2];
const log=(...a)=>console.log(...a);
(async()=>{
  const browser=await chromium.launch();
  // ---------- DESKTOP ----------
  let ctx=await browser.newContext({viewport:{width:1440,height:900}});
  let p=await ctx.newPage();
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  const reqs=new Set(); p.on('request',r=>{const u=new URL(r.url()); if(!u.pathname.startsWith('/assets')) reqs.add(r.method()+' '+u.host+u.pathname)});
  await p.goto(SITE,{waitUntil:'networkidle'});
  const shot=async n=>{await p.screenshot({path:`${out}/${n}.png`,fullPage:true})};
  const nav=async t=>{await p.locator('.side-nav button',{hasText:t}).click(); await p.waitForTimeout(200)};
  await shot('d01-home-manager');
  // View all button
  const before=await p.locator('h1').innerText(); await p.getByRole('button',{name:'View all'}).click(); await p.waitForTimeout(300);
  log('ViewAll: h1 before/after =',before,'/',await p.locator('h1').innerText(),'dialogs=',await p.locator('[role=dialog]').count());
  await p.getByRole('button',{name:'Review low stock'}).click(); await p.waitForTimeout(200);
  log('ReviewLowStock -> h1:',await p.locator('h1').innerText(),'active filter:',await p.locator('.filters button.active').innerText());
  await shot('d02-inventory-manager');
  for(const f of ['In stock','Low stock','All items']){await p.locator('.filters button',{hasText:f}).click(); log('filter',f,'->',await p.locator('.product-card h3').allInnerTexts());}
  await p.fill('input[aria-label="Search inventory"]','vlr-rc'); log('search vlr-rc ->',await p.locator('.product-card h3').allInnerTexts());
  await p.fill('input[aria-label="Search inventory"]','zzz'); await shot('d03-inventory-empty'); log('empty:',await p.locator('.empty-state').innerText());
  await p.fill('input[aria-label="Search inventory"]','');
  // add inventory
  await p.getByRole('button',{name:'+ Add inventory'}).click(); await shot('d04-add-inventory');
  await p.getByRole('button',{name:'Save inventory'}).click(); log('add modal still open after empty submit:',await p.locator('#add-title').count());
  await p.fill('input[name=name]','Test Pearl Ring'); await p.fill('input[name=weight]','3.5'); await p.fill('textarea[name=description]','Audit item');
  await p.fill('input[name=quantity]','2'); await p.fill('input[name=purchasePrice]','1000.55'); await p.fill('input[name=defaultMarkup]','10'); await p.fill('input[name=minimumMarkup]','40');
  await p.fill('input[name=sku]','VLR-BR-001'); // duplicate SKU, min > default
  log('purchase total text:',await p.locator('.purchase-total').innerText());
  await p.getByRole('button',{name:'Save inventory'}).click(); await p.waitForTimeout(300);
  log('toast:',await p.locator('.toast').innerText().catch(()=>'none'));
  log('after add: products with SKU VLR-BR-001 =',await p.locator('.sku-line span:first-child',{hasText:'VLR-BR-001'}).count(),'first card:',(await p.locator('.product-card').first().innerText()).replace(/\n/g,' | '));
  // open pricing for new item (default 10 < min 40)
  await p.locator('.product-card').first().click(); await p.waitForTimeout(200);
  log('pricing(new item min40 default10):',(await p.locator('.pricing-modal').innerText()).replace(/\n/g,' | '));
  const r=p.locator('#markup'); log('slider min/max/value:',await r.getAttribute('min'),await r.getAttribute('max'),await r.inputValue());
  await shot('d05-pricing-manager');
  await p.locator('.pricing-modal .modal-head button').click();
  // Price Alhambra at two markups to exceed stock
  await nav('New sale'); await shot('d06-newsale-manager');
  const setPrice=async(name,markup,clicks)=>{await p.locator('.sale-list article',{hasText:name}).getByRole('button',{name:'Set price'}).click(); await p.locator('#markup').fill(String(markup)); for(let i=0;i<clicks;i++) await p.locator('.stepper button').last().click(); const t=(await p.locator('.pricing-foot').innerText()).replace(/\n/g,' ');const q=await p.locator('.stepper span').innerText(); await p.getByRole('button',{name:'Add to cart'}).click(); await p.waitForTimeout(150); return q+' @'+markup+' '+t;};
  log('add DTB 20% x(try 10):',await setPrice('Diamond Tennis',20,10));
  log('add DTB 25% x(try 10):',await setPrice('Diamond Tennis',25,10));
  log('add Rose 33% x1:',await setPrice('Rose Gold Cuff',33,0));
  log('cart badge:',await p.locator('.cart-button span').innerText());
  await p.locator('.cart-button').click(); await p.waitForTimeout(200);
  log('cart buttons disabled (no customer):',await p.getByRole('button',{name:'Save quotation'}).isDisabled(),await p.getByRole('button',{name:'Proceed to invoice'}).isDisabled());
  await p.fill('input[placeholder="Company name"]','Audit Co'); log('enabled with company only:',!(await p.getByRole('button',{name:'Proceed to invoice'}).isDisabled()));
  await p.fill('input[placeholder="Full name"]','Test Buyer'); await p.fill('input[placeholder="+971 ..."]','+971 50 000 0000'); await p.fill('input[type=email]','not-an-email');
  const disc=p.locator('.order-adjustments input[type=number]');
  await disc.fill('-500'); log('totals with discount -500:',(await p.locator('.order-totals').innerText()).replace(/\n/g,' '));
  await disc.fill('99999999'); log('totals with discount 99999999:',(await p.locator('.order-totals').innerText()).replace(/\n/g,' '));
  await disc.fill('100.5'); log('totals with discount 100.5 VAT5:',(await p.locator('.order-totals').innerText()).replace(/\n/g,' '));
  await p.locator('.order-adjustments select').selectOption('0'); log('VAT0:',(await p.locator('.order-totals').innerText()).replace(/\n/g,' '));
  await p.locator('.order-adjustments select').selectOption('5');
  await shot('d07-cart');
  await p.getByRole('button',{name:'Save quotation'}).click(); await p.waitForTimeout(300); await shot('d08-quotation-doc');
  log('quotation doc:',(await p.locator('.invoice-paper').innerText()).replace(/\n/g,' | '));
  log('wa link:',await p.locator('.invoice-actions a').getAttribute('href'));
  await p.getByRole('button',{name:'← Back'}).click();
  log('cart badge after quotation:',await p.locator('.cart-button span').innerText());
  await p.locator('.cart-button').click(); await p.waitForTimeout(200);
  log('customer name retained after reopening cart:',JSON.stringify(await p.locator('input[placeholder="Full name"]').inputValue()));
  await p.fill('input[placeholder="Full name"]','Test Buyer');
  await p.getByRole('button',{name:'Proceed to invoice'}).click(); await p.waitForTimeout(200); await shot('d09-payment-cash');
  log('payment modal:',(await p.locator('.payment-modal').innerText()).replace(/\n/g,' | '));
  for(const m of ['Bank Transfer','Credit','Partial']){await p.locator('.payment-methods button',{hasText:m}).click(); await p.waitForTimeout(100); log('method',m,':',(await p.locator('.payment-content').innerText()).replace(/\n/g,' | ')); await shot('d10-payment-'+m.replace(' ','').toLowerCase());}
  const amt=p.locator('.payment-content input[type=number]'); await amt.fill('999999'); log('overpay summary:',await p.locator('.payment-summary').innerText());
  await amt.fill('-50'); log('negative summary:',(await p.locator('.payment-content .single-field small').first().innerText()),await p.locator('.payment-summary').innerText());
  await amt.fill('1000');
  await p.getByRole('button',{name:'Generate final invoice'}).click(); await p.waitForTimeout(300); await shot('d11-invoice-doc-partial');
  log('invoice doc:',(await p.locator('.invoice-paper').innerText()).replace(/\n/g,' | '));
  await p.getByRole('button',{name:'← Back'}).click();
  await nav('Inventory'); log('stock after sale:',await p.locator('.product-card').evaluateAll(els=>els.map(e=>e.querySelector('h3').innerText+'='+e.querySelector('.price-line div:last-child strong').innerText)));
  await nav('New sale'); log('sale list (out-of-stock hidden?):',await p.locator('.sale-list h3').allInnerTexts());
  await nav('Invoices'); await shot('d12-invoices'); log('records:',await p.locator('.record-row').evaluateAll(e=>e.map(x=>x.innerText.replace(/\n/g,' | '))));
  for(const f of ['Paid','Credit','Partial','Quotation','All']){await p.locator('.filters button',{hasText:new RegExp('^'+f+'$')}).click(); log('filter',f,await p.locator('.record-row > div:first-child strong').allInnerTexts());}
  await p.fill('input[placeholder="Search invoice or customer"]','maison'); log('search maison:',await p.locator('.record-row > div:first-child strong').allInnerTexts());
  await p.fill('input[placeholder="Search invoice or customer"]','qqq'); log('empty:',await p.locator('.empty-state').innerText()); await p.fill('input[placeholder="Search invoice or customer"]','');
  await p.locator('.record-row',{hasText:'INV-2026-00124'}).getByRole('button').click(); await shot('d13-invoice-credit'); log('credit doc buttons:',await p.locator('.invoice-actions').innerText()); await p.getByRole('button',{name:'← Back'}).click();
  await nav('Reports'); await shot('d14-reports-manager'); log('reports manager:',(await p.locator('.reports-page').innerText()).replace(/\n/g,' | '));
  await nav('Overview'); log('home after sale:',(await p.locator('.metric-grid').innerText()).replace(/\n/g,' | '),'| hero:',(await p.locator('.hero-total').innerText()).replace(/\n/g,' '),'| alert:',(await p.locator('.stock-alert').innerText()).replace(/\n/g,' '));
  // role: sales
  await p.locator('.role-switch select').selectOption('sales'); await p.waitForTimeout(200); await shot('d15-home-sales');
  log('SALES home:',(await p.locator('.page-content').innerText()).replace(/\n/g,' | ').slice(0,900)); log('add btn visible for sales:',await p.getByRole('button',{name:'+ Add inventory'}).count());
  await nav('Inventory'); await shot('d16-inventory-sales'); log('SALES inv card:',(await p.locator('.product-card').nth(1).innerText()).replace(/\n/g,' | '));
  await p.locator('.product-card').nth(1).click(); await shot('d17-pricing-sales'); log('SALES pricing:',(await p.locator('.pricing-modal').innerText()).replace(/\n/g,' | ')); await p.locator('.pricing-modal .modal-head button').click();
  await nav('Invoices'); log('SALES records:',await p.locator('.record-row > div:first-child strong').allInnerTexts());
  await nav('Reports'); await shot('d18-reports-sales'); log('SALES reports:',(await p.locator('.reports-page').innerText()).replace(/\n/g,' | '));
  // persistence
  log('localStorage keys:',await p.evaluate(()=>Object.keys(localStorage).map(k=>k+':'+localStorage[k].length)));
  await p.reload({waitUntil:'networkidle'}); log('after reload: role=',await p.locator('.role-switch select').inputValue(),'cart=',await p.locator('.cart-button span').innerText(),'page=',await p.locator('h1').innerText());
  await nav('Invoices'); log('records persisted count:',await p.locator('.record-row').count());
  // keyboard / a11y probes
  await nav('Inventory'); await p.locator('.product-card').first().click(); await p.keyboard.press('Escape'); await p.waitForTimeout(150); log('Esc closes modal:',await p.locator('.pricing-modal').count()===0);
  if(await p.locator('.pricing-modal').count()) await p.locator('.pricing-modal .modal-head button').click();
  log('non-asset requests:',[...reqs]); log('console errors:',errs.slice(0,5));
  await ctx.close();
  // ---------- MOBILE ----------
  ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); p=await ctx.newPage(); await p.goto(SITE,{waitUntil:'networkidle'});
  const ms=async n=>p.screenshot({path:`${out}/${n}.png`,fullPage:true}); const mnav=async t=>{await p.locator('.mobile-nav button',{hasText:t}).click(); await p.waitForTimeout(200)};
  await ms('m01-home'); log('MOBILE nav items:',await p.locator('.mobile-nav button').allInnerTexts(),'sidebar visible:',await p.locator('.sidebar').isVisible());
  log('MOBILE topbar: add-inventory visible:',await p.locator('.topbar .primary-button').isVisible().catch(()=>false),'cart visible:',await p.locator('.cart-button').isVisible(),'role switch visible:',await p.locator('.role-switch').isVisible());
  log('MOBILE quick action "Add new stock" visible:',await p.getByText('Add new stock').isVisible());
  await mnav('Inventory'); await ms('m02-inventory'); await p.locator('.product-card').first().tap(); await p.waitForTimeout(200); await ms('m03-pricing');
  await p.getByRole('button',{name:'Add to cart'}).tap(); await mnav('Sale'); await ms('m04-sale'); await p.locator('.cart-button').tap(); await p.waitForTimeout(200); await ms('m05-cart');
  await p.fill('input[placeholder="Full name"]','Mob Buyer'); await p.getByRole('button',{name:'Proceed to invoice'}).tap(); await p.waitForTimeout(200); await ms('m06-payment');
  await p.getByRole('button',{name:'Generate final invoice'}).tap(); await p.waitForTimeout(300); await ms('m07-invoice-doc'); await p.getByRole('button',{name:'← Back'}).tap();
  await mnav('Invoices'); await ms('m08-invoices');
  await p.getByText('Add new stock').tap().catch(async()=>{await mnav('Home'); await p.getByText('Add new stock').tap()}); await p.waitForTimeout(200); await ms('m09-add-inventory');
  const small=await p.evaluate(()=>{let n=0,t=0;document.querySelectorAll('button,a,input,select').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width&&r.height){t++; if(r.height<44||r.width<44)n++}});return n+'/'+t});
  log('MOBILE touch targets <44px:',small);
  await ctx.close();
  // tablet
  ctx=await browser.newContext({viewport:{width:820,height:1180}}); p=await ctx.newPage(); await p.goto(SITE,{waitUntil:'networkidle'}); await p.screenshot({path:`${out}/t01-home.png`,fullPage:true}); log('TABLET 820: sidebar visible:',await p.locator('.sidebar').isVisible(),'mobile nav visible:',await p.locator('.mobile-nav').isVisible());
  await browser.close();
})().catch(e=>{console.error('SCRIPT FAIL',e);process.exit(1)});
