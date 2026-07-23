// DeducTrack AU v7 - Australian Tax Invoice Manager with Gemini AI Autofill

var CATEGORIES = {
    work:      { icon: 'fa-briefcase',          label: 'Work',        color: '#38bdf8' },
    vehicle:   { icon: 'fa-car',                label: 'Vehicle',     color: '#fbbf24' },
    home:      { icon: 'fa-home',               label: 'Home Office', color: '#4ade80' },
    health:    { icon: 'fa-heartbeat',          label: 'Health',      color: '#f87171' },
    education: { icon: 'fa-graduation-cap',     label: 'Education',   color: '#a78bfa' },
    investment:{ icon: 'fa-chart-line',         label: 'Investment',  color: '#f472b6' },
    donation:  { icon: 'fa-hand-holding-heart', label: 'Donation',    color: '#4ade80' },
    other:     { icon: 'fa-ellipsis-h',         label: 'Other',       color: '#94a3b8' }
};

var TAX_BRACKETS = [
    { label: '$0 - $18,200',        rate: 0.00, min: 0,      max: 18200 },
    { label: '$18,201 - $45,000',   rate: 0.16, min: 18201,  max: 45000 },
    { label: '$45,001 - $135,000',  rate: 0.30, min: 45001,  max: 135000 },
    { label: '$135,001 - $190,000', rate: 0.37, min: 135001, max: 190000 },
    { label: '$190,001+',           rate: 0.45, min: 190001, max: 999999999 }
];

var invoices = [];
var currentFilter = 'all';
var currentCategory = 'work';
var cameraStream = null;
var capturedImage = null;
var taxRate = 0.30;
var userIncome = 70000;
var currentFY = '2025-26';
var editingId = null;
var viewingId = null;
var receiptView = 'home';

// ---------- INIT ----------
function init() {
    console.log('DeducTrack AU init with AI Receipt Scanner');
    loadData();
    ensureCurrentFY();
    updateSettingsUI();
    renderInvoices();
    updateStats();
    setupEvents();
    updateAccountUI();
    window.addEventListener('dt-auth-change', function(e){
        updateAccountUI();
        if(e.detail) loadCloudInvoices();
    });
    if(window.DTCloudUser) loadCloudInvoices();

    setTimeout(function(){
        var s = document.getElementById('splash');
        var a = document.getElementById('app');
        if(s) s.classList.add('hidden');
        if(a) a.classList.add('active');
    }, 1200);
}

function setupEvents() {
    document.querySelectorAll('.modal-overlay').forEach(function(el){
        el.addEventListener('click', function(e){
            if(e.target === el){
                el.classList.remove('open');
                if(el.id === 'scanModal') stopCamera();
            }
        });
    });
}

// ---------- DATA PERSISTENCE ----------
function loadData() {
    try {
        var d = localStorage.getItem('dt_invoices');
        if(d) invoices = JSON.parse(d);
        var r = localStorage.getItem('dt_taxRate');
        if(r) taxRate = parseFloat(r);
        var i = localStorage.getItem('dt_income');
        if(i) userIncome = parseFloat(i);
        var f = localStorage.getItem('dt_fy');
        if(f) currentFY = f;
    } catch(e) {}
}

function saveData() {
    try {
        localStorage.setItem('dt_invoices', JSON.stringify(invoices));
        localStorage.setItem('dt_taxRate', taxRate);
        localStorage.setItem('dt_income', userIncome);
        localStorage.setItem('dt_fy', currentFY);
    } catch(e) {
        console.log('Storage error:', e);
        if(e.name === 'QuotaExceededError'){
            toast('Storage full! Delete old invoices or clear data.', 'error');
        }
    }
}

// ---------- ACCOUNT & CLOUD SYNC ----------
function updateAccountUI() {
    var user = window.DTCloudUser;
    var name = document.getElementById('accountName');
    var subtitle = document.getElementById('accountSubtitle');
    var action = document.getElementById('accountAction');
    var logout = document.getElementById('accountLogout');
    if(user) {
        if(name) name.textContent = user.displayName || user.email || 'Signed in';
        if(subtitle) subtitle.textContent = 'Invoice details are securely syncing to your account';
        if(action) action.style.display = 'none';
        if(logout) logout.style.display = '';
    } else {
        if(name) name.textContent = 'Your account';
        if(subtitle) subtitle.textContent = 'Sign in to securely sync invoice details';
        if(action) action.style.display = '';
        if(logout) logout.style.display = 'none';
    }
}

function openAuthModal() {
    var msg = document.getElementById('authMessage');
    if(msg) msg.textContent = '';
    var modal = document.getElementById('authModal');
    if(modal) modal.classList.add('open');
}

function authError(error) {
    var message = error && error.message ? error.message.replace('Firebase: ', '') : 'Unable to sign in. Please try again.';
    var msg = document.getElementById('authMessage');
    if(msg) { msg.style.color = 'var(--danger)'; msg.textContent = message; }
}

function signInWithGoogle() {
    if(!window.DTCloud) { authError({message:'Connecting to Firebase. Please try again in a moment.'}); return; }
    window.DTCloud.googleSignIn().then(function(){ closeModal('authModal'); toast('Signed in successfully!', 'success'); }).catch(authError);
}

function signInWithEmail() {
    var email = document.getElementById('authEmail').value.trim();
    var password = document.getElementById('authPassword').value;
    if(!email || !password) { authError({message:'Enter your email and password.'}); return; }
    window.DTCloud.emailSignIn(email,password).then(function(){ closeModal('authModal'); toast('Signed in successfully!', 'success'); }).catch(authError);
}

function createAccount() {
    var email = document.getElementById('authEmail').value.trim();
    var password = document.getElementById('authPassword').value;
    if(!email || password.length < 6) { authError({message:'Enter an email and a password of at least 6 characters.'}); return; }
    window.DTCloud.emailSignUp(email,password).then(function(){ closeModal('authModal'); toast('Account created!', 'success'); }).catch(authError);
}

function signOutAccount() {
    if(!window.DTCloud) return;
    window.DTCloud.signOut().then(function(){ toast('Signed out', 'success'); }).catch(authError);
}

function syncInvoiceToCloud(invoice) {
    if(window.DTCloud && window.DTCloudUser) window.DTCloud.saveInvoice(invoice).catch(function(e){ console.log('Cloud save error', e); });
}

function removeInvoiceFromCloud(id) {
    if(window.DTCloud && window.DTCloudUser) window.DTCloud.deleteInvoice(id).catch(function(e){ console.log('Cloud delete error', e); });
}

function loadCloudInvoices() {
    if(!window.DTCloud || !window.DTCloudUser) return;
    window.DTCloud.getInvoices().then(function(cloudInvoices){
        var localById = {};
        for(var i=0;i<invoices.length;i++) localById[String(invoices[i].id)] = invoices[i];
        for(var j=0;j<cloudInvoices.length;j++) {
            var remote = cloudInvoices[j];
            var local = localById[String(remote.id)];
            if(!local || (remote.cloudUpdatedAt || 0) > (local.cloudUpdatedAt || 0)) {
                if(local && local.image) remote.image = local.image;
                localById[String(remote.id)] = remote;
            }
        }
        invoices = Object.keys(localById).map(function(key){ return localById[key]; });
        ensureCurrentFY(); saveData(); renderInvoices(); updateStats();
    }).catch(function(e){ console.log('Cloud load error', e); });
}

// ---------- FY & DATES ----------
function getFYDates() {
    var parts = currentFY.split('-');
    var startYear = parseInt('20' + parts[0]);
    return {
        start: new Date(startYear + '-07-01'),
        end: new Date((startYear + 1) + '-06-30')
    };
}

function getFYInvoices() {
    var fy = getFYDates();
    var out = [];
    for(var i=0;i<invoices.length;i++){
        var d = new Date(invoices[i].date);
        if(d >= fy.start && d <= fy.end) out.push(invoices[i]);
    }
    return out;
}

function getFinancialYear(dateValue) {
    var d = new Date(dateValue);
    if(isNaN(d.getTime())) return null;
    var startYear = d.getFullYear() - (d.getMonth() < 6 ? 1 : 0);
    return String(startYear).slice(-2) + '-' + String(startYear + 1).slice(-2);
}

function getInvoiceFinancialYears(imagesOnly) {
    var years = {};
    for(var i=0;i<invoices.length;i++) {
        if(imagesOnly && !invoices[i].image) continue;
        var fy = getFinancialYear(invoices[i].date);
        if(fy) years[fy] = true;
    }
    return Object.keys(years).sort().reverse();
}

function ensureCurrentFY() {
    var years = getInvoiceFinancialYears(false);
    if(years.length && years.indexOf(currentFY) === -1) currentFY = years[0];
}

// ---------- STATS ----------
function updateStats() {
    var fyInv = getFYInvoices();
    var total = 0;
    for(var i=0;i<fyInv.length;i++) total += fyInv[i].amount;
    var gst = total / 11;
    var refund = total * taxRate;
    var elTotal = document.getElementById('statTotal');
    var elGst = document.getElementById('statGst');
    var elRefund = document.getElementById('statRefund');
    var elCount = document.getElementById('statCount');
    var elFY = document.getElementById('fyLabel');
    var elRate = document.getElementById('rateLabel');
    if(elTotal) elTotal.textContent = fmt$(total);
    if(elGst) elGst.textContent = fmt$(gst);
    if(elRefund) elRefund.textContent = fmt$(refund);
    if(elCount) elCount.textContent = fyInv.length;
    if(elFY) elFY.textContent = currentFY;
    if(elRate) elRate.textContent = (taxRate * 100).toFixed(1) + '%';
}

function fmt$(n) {
    if(typeof n !== 'number') n = 0;
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(s) {
    if(!s) return '';
    var d = new Date(s);
    if(isNaN(d.getTime())) return s;
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
}

function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

// ---------- RENDER INVOICES ----------
function renderInvoices() {
    var list = document.getElementById('invoiceList');
    if(!list) return;
    var search = document.getElementById('searchInput');
    var term = search ? search.value.toLowerCase() : '';
    var dateFilter = document.getElementById('dateFilter');
    var selectedDate = dateFilter ? dateFilter.value : '';
    var fyInv = getFYInvoices();
    var filtered = [];
    for(var i=0;i<fyInv.length;i++){
        var inv = fyInv[i];
        if(currentFilter !== 'all' && inv.category !== currentFilter) continue;
        if(term){
            var dm = (inv.description + ' ' + (inv.merchant||'')).toLowerCase();
            if(dm.indexOf(term) === -1) continue;
        }
        if(selectedDate && inv.date !== selectedDate) continue;
        filtered.push(inv);
    }
    filtered.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
    var countEl = document.getElementById('invoiceCount');
    var showing = receiptView === 'home' ? filtered.slice(0,10) : filtered;
    var title = document.getElementById('invoiceSectionTitle');
    var homeViewAll = document.getElementById('homeViewAll');
    if(title) title.textContent = receiptView === 'home' ? 'Recent invoices' : 'All receipts';
    if(homeViewAll) homeViewAll.style.display = receiptView === 'home' && filtered.length > 10 ? 'block' : 'none';
    if(countEl) countEl.textContent = receiptView === 'home' ? Math.min(filtered.length,10) + ' of ' + filtered.length : filtered.length + ' items';
    document.querySelectorAll('.fy-empty').forEach(function(el){ el.textContent = currentFY; });
    if(filtered.length === 0){
        list.innerHTML = '<div class="empty-state"><i class="fas fa-receipt"></i><h3>No invoices yet for FY ' + currentFY + '</h3><p>Tap the + button to add or scan your first receipt</p></div>';
        return;
    }
    var html = '';
    var previousDate = '';
    for(var i=0;i<showing.length;i++){
        var inv = showing[i];
        if(receiptView === 'all' && inv.date !== previousDate) {
            html += '<div class="date-group-title">' + fmtDate(inv.date) + '</div>';
            previousDate = inv.date;
        }
        var cat = CATEGORIES[inv.category] || CATEGORIES.other;
        var img = '';
        if(inv.image){
            img = '<img src="' + inv.image + '" class="receipt-thumb" style="margin:0 16px 12px;max-height:200px;object-fit:cover;border-radius:12px">';
        }
        html += '<div class="invoice-card" style="animation-delay:' + (i*0.05) + 's" onclick="viewInvoice(' + inv.id + ')">' +
            '<div class="invoice-main">' +
            '<div class="invoice-icon ' + inv.category + '"><i class="fas ' + cat.icon + '"></i></div>' +
            '<div class="invoice-info"><div class="invoice-title">' + esc(inv.description) + '</div>' +
            '<div class="invoice-meta">' + esc(inv.merchant||'Unknown') + ' &middot; ' + fmtDate(inv.date) + (inv.abn?' &middot; ABN: '+inv.abn:'') + '</div></div>' +
            '<div class="invoice-amount"><div class="amount">' + fmt$(inv.amount) + '</div><div class="gst">GST: ' + fmt$(inv.amount/11) + '</div></div>' +
            '</div>' + img +
            '</div>';
    }
    list.innerHTML = html;
}

function showHome() {
    receiptView = 'home';
    document.getElementById('navHome').classList.add('active');
    document.getElementById('navReceipts').classList.remove('active');
    document.getElementById('navSummary').classList.remove('active');
    document.getElementById('navExport').classList.remove('active');
    renderInvoices();
    window.scrollTo({top:0,behavior:'smooth'});
}

function showAllReceipts() {
    receiptView = 'all';
    document.getElementById('navReceipts').classList.add('active');
    document.getElementById('navHome').classList.remove('active');
    document.getElementById('navSummary').classList.remove('active');
    document.getElementById('navExport').classList.remove('active');
    renderInvoices();
    window.scrollTo({top:0,behavior:'smooth'});
}

// ---------- FILTER ----------
function setFilter(cat) {
    currentFilter = cat;
    document.querySelectorAll('.filter-chip').forEach(function(chip){
        chip.classList.toggle('active', chip.dataset.cat === cat);
    });
    renderInvoices();
}

// ---------- MODALS ----------
function openAddModal() {
    editingId = null;
    var form = document.getElementById('addForm');
    if(form) form.reset();
    var today = new Date();
    var dateEl = document.getElementById('invDate');
    if(dateEl) dateEl.value = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    var pc = document.getElementById('receiptPreviewContainer');
    var ii = document.getElementById('invImage');
    if(pc) pc.style.display = 'none';
    if(ii) ii.value = '';
    
    var aiBadge = document.getElementById('aiFillBadge');
    if(aiBadge) aiBadge.style.display = 'none';
    var aiLoader = document.getElementById('aiExtractLoader');
    if(aiLoader) aiLoader.classList.remove('active');

    capturedImage = null;
    selectCat(document.querySelector('.category-option[data-cat="work"]'));
    var modal = document.getElementById('addModal');
    if(modal) modal.classList.add('open');
}

function openScanModal() {
    var modal = document.getElementById('scanModal');
    if(modal) modal.classList.add('open');
    startCamera();
}

function closeModal(id) {
    var modal = document.getElementById(id);
    if(modal) modal.classList.remove('open');
}

// ---------- CATEGORY ----------
function selectCat(el) {
    if(!el) return;
    document.querySelectorAll('.category-option').forEach(function(c){ c.classList.remove('selected'); });
    el.classList.add('selected');
    currentCategory = el.dataset.cat;
}

function compressDataUrlPromise(dataUrl, maxDim, quality) {
    return new Promise(function(resolve) {
        if(!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
            resolve(dataUrl);
            return;
        }
        compressImage(dataUrl, maxDim || 1000, quality || 0.75, function(compressed){
            resolve(compressed);
        });
    });
}

// ---------- GEMINI AI RECEIPT AUTOFILL ----------
async function extractReceiptDataWithAI(imageDataUrl) {
    var loader = document.getElementById('aiExtractLoader');
    var badge = document.getElementById('aiFillBadge');
    if(loader) loader.classList.add('active');
    if(badge) badge.style.display = 'none';

    try {
        toast('Gemini AI scanning receipt image...', 'ai');

        var optimizedImage = await compressDataUrlPromise(imageDataUrl, 1000, 0.75);

        // Check if Android Native Interface exists
        if(window.AndroidGeminiAI && typeof window.AndroidGeminiAI.extractReceipt === 'function') {
            window.AndroidGeminiAI.extractReceipt(optimizedImage);
            return;
        }

        var endpoint = '/api/extract-receipt';
        if (window.location.protocol === 'file:' || !window.location.host) {
            endpoint = 'https://ais-dev-z7pp2jud3pcyk76y3h5evc-681590443536.asia-southeast1.run.app/api/extract-receipt';
        }

        var customOcrUrl = localStorage.getItem('customOcrUrl') || '';

        var res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: optimizedImage,
                customOcrUrl: customOcrUrl
            })
        }).catch(function(fetchErr) {
            console.warn('Fetch failed:', fetchErr);
            return null;
        });

        if(!res) {
            if(loader) loader.classList.remove('active');
            toast('Network connection failed. Please check internet access or fill details manually.', 'error');
            return;
        }

        var json = await res.json().catch(function(){ return null; });

        if(!res.ok || !json) {
            if(loader) loader.classList.remove('active');
            toast((json && json.error) ? json.error : 'AI scanning failed. Please enter details manually.', 'error');
            return;
        }

        if(json.success && json.data) {
            handleAIExtractedData(json.data);
        } else {
            if(loader) loader.classList.remove('active');
            toast('Could not extract receipt data. Please enter details manually.', 'error');
        }
    } catch(err) {
        console.error('AI Extraction error:', err);
        if(loader) loader.classList.remove('active');
        toast('AI Scan notice: ' + (err.message || 'Please fill details manually.'), 'error');
    } finally {
        if(!window.AndroidGeminiAI && loader) {
            loader.classList.remove('active');
        }
    }
}

function handleAIExtractedData(data) {
    var loader = document.getElementById('aiExtractLoader');
    var badge = document.getElementById('aiFillBadge');
    if(loader) loader.classList.remove('active');

    if(!data) {
        toast('No readable receipt data found. Please enter details manually.', 'error');
        return;
    }

    if(data.isReceipt === false) {
        toast(data.unreadableReason || 'Image is blank or not a readable receipt.', 'error');
        return;
    }

    var descEl = document.getElementById('invDesc');
    var amountEl = document.getElementById('invAmount');
    var dateEl = document.getElementById('invDate');
    var merchantEl = document.getElementById('invMerchant');
    var abnEl = document.getElementById('invAbn');
    var notesEl = document.getElementById('invNotes');

    var filledCount = 0;

    if(data.description && descEl) { descEl.value = data.description; descEl.classList.add('ai-field-highlight'); filledCount++; }
    if(data.amount && parseFloat(data.amount) > 0 && amountEl) { amountEl.value = parseFloat(data.amount).toFixed(2); amountEl.classList.add('ai-field-highlight'); filledCount++; }
    if(data.date && dateEl) { dateEl.value = data.date; dateEl.classList.add('ai-field-highlight'); filledCount++; }
    if(data.merchant && merchantEl) { merchantEl.value = data.merchant; merchantEl.classList.add('ai-field-highlight'); filledCount++; }
    if(data.abn && abnEl) { abnEl.value = data.abn; abnEl.classList.add('ai-field-highlight'); filledCount++; }
    if(data.notes && notesEl) { notesEl.value = data.notes; notesEl.classList.add('ai-field-highlight'); filledCount++; }

    if(data.category) {
        var validCategory = CATEGORIES[data.category] ? data.category : 'other';
        var catOpt = document.querySelector('.category-option[data-cat="' + validCategory + '"]');
        if(catOpt) selectCat(catOpt);
    }

    if(filledCount > 0) {
        if(badge) badge.style.display = 'inline-flex';
        var summaryMsg = 'AI extracted: ' + (data.merchant || 'Receipt') + (data.amount ? ' ($' + parseFloat(data.amount).toFixed(2) + ')' : '');
        toast(summaryMsg, 'ai');

        setTimeout(function(){
            [descEl, amountEl, dateEl, merchantEl, abnEl, notesEl].forEach(function(el){
                if(el) el.classList.remove('ai-field-highlight');
            });
        }, 3000);
    } else {
        toast('Image scanned, but no clear receipt details found. Please fill in fields.', 'error');
    }
}

// Window callback for Android Native Bridge
window.onAndroidAIExtracted = function(jsonString) {
    try {
        var clean = jsonString ? jsonString.trim() : '';
        if(clean.indexOf('```') !== -1) {
            clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        }
        var match = clean.match(/\{[\s\S]*\}/);
        if(match) clean = match[0];
        var data = JSON.parse(clean);
        handleAIExtractedData(data);
    } catch(e) {
        console.error('Failed to parse Android AI response:', e);
        var loader = document.getElementById('aiExtractLoader');
        if(loader) loader.classList.remove('active');
        toast('Loaded image! Review & fill details manually.', 'error');
    }
};

window.onAndroidAIError = function(errorMsg) {
    console.error('Android AI error:', errorMsg);
    var loader = document.getElementById('aiExtractLoader');
    if(loader) loader.classList.remove('active');
    toast(errorMsg || 'AI Extraction failed. Review details manually.', 'error');
};

// ---------- CAMERA ----------
function startCamera() {
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Camera not supported. Use upload instead.', 'error'); return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(function(stream){
        cameraStream = stream;
        var preview = document.getElementById('cameraPreview');
        if(preview){
            preview.innerHTML = '<video id="camVideo" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>' +
                '<div class="camera-corner tl"></div><div class="camera-corner tr"></div>' +
                '<div class="camera-corner bl"></div><div class="camera-corner br"></div>';
            var video = document.getElementById('camVideo');
            if(video) video.srcObject = stream;
        }
    }).catch(function(){
        toast('Camera access denied. Use upload instead.', 'error');
    });
}

function stopCamera() {
    if(cameraStream){
        cameraStream.getTracks().forEach(function(t){ t.stop(); });
        cameraStream = null;
    }
}

function capturePhoto() {
    var video = document.getElementById('camVideo');
    if(!video) return;
    toast('Capturing & compressing...', 'success');
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0);
    var raw = canvas.toDataURL('image/jpeg', 0.9);
    compressImage(raw, 1200, 0.7, function(compressed){
        capturedImage = compressed;
        stopCamera();
        closeModal('scanModal');
        
        if(!document.getElementById('addModal').classList.contains('open')) {
            openAddModal();
        }
        
        var preview = document.getElementById('receiptPreview');
        var container = document.getElementById('receiptPreviewContainer');
        var imgInput = document.getElementById('invImage');
        if(preview) preview.src = capturedImage;
        if(container) container.style.display = 'block';
        if(imgInput) imgInput.value = capturedImage;

        // Trigger AI extraction
        extractReceiptDataWithAI(capturedImage);
    });
}

// ---------- UPLOAD ----------
function triggerUpload() {
    openAddModal();
    setTimeout(function(){
        var input = document.getElementById('fileUpload');
        if(input) input.click();
    }, 300);
}

function handleFileUpload(e) {
    var file = e.target.files[0];
    if(!file) return;
    toast('Loading image...', 'success');
    var reader = new FileReader();
    reader.onload = function(ev){
        compressImage(ev.target.result, 1200, 0.7, function(compressed){
            capturedImage = compressed;
            var preview = document.getElementById('receiptPreview');
            var container = document.getElementById('receiptPreviewContainer');
            var imgInput = document.getElementById('invImage');
            if(preview) preview.src = capturedImage;
            if(container) container.style.display = 'block';
            if(imgInput) imgInput.value = capturedImage;

            // Trigger AI Extraction
            extractReceiptDataWithAI(capturedImage);
        });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function addImageFromCamera() {
    var modal = document.getElementById('addModal');
    if(modal) modal.classList.remove('open');
    openScanModal();
}

function addImageFromUpload() {
    var input = document.getElementById('editFileUpload');
    if(input) input.click();
}

function handleEditFileUpload(e) {
    var file = e.target.files[0];
    if(!file) return;
    toast('Compressing image...', 'success');
    var reader = new FileReader();
    reader.onload = function(ev){
        compressImage(ev.target.result, 1200, 0.7, function(compressed){
            capturedImage = compressed;
            var preview = document.getElementById('receiptPreview');
            var container = document.getElementById('receiptPreviewContainer');
            var imgInput = document.getElementById('invImage');
            if(preview) preview.src = capturedImage;
            if(container) container.style.display = 'block';
            if(imgInput) imgInput.value = capturedImage;

            // Trigger AI Extraction
            extractReceiptDataWithAI(capturedImage);
        });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

// ---------- IMAGE COMPRESSION ----------
function compressImage(dataUrl, maxWidth, quality, callback) {
    var img = new Image();
    img.onload = function(){
        var canvas = document.createElement('canvas');
        var w = img.width;
        var h = img.height;
        if(w > maxWidth){
            h = Math.round(h * (maxWidth / w));
            w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var compressed = canvas.toDataURL('image/jpeg', quality);
        callback(compressed);
    };
    img.src = dataUrl;
}

// ---------- SAVE INVOICE ----------
function saveInvoice(e) {
    e.preventDefault();
    var descEl = document.getElementById('invDesc');
    var amountEl = document.getElementById('invAmount');
    var dateEl = document.getElementById('invDate');
    var merchantEl = document.getElementById('invMerchant');
    var abnEl = document.getElementById('invAbn');
    var notesEl = document.getElementById('invNotes');
    var imageEl = document.getElementById('invImage');

    var amount = parseFloat(amountEl ? amountEl.value : 0);
    if(isNaN(amount) || amount <= 0){
        toast('Please enter a valid amount', 'error'); return;
    }
    var invoice = {
        id: editingId || Date.now(),
        category: currentCategory,
        description: descEl ? descEl.value.trim() : '',
        amount: amount,
        date: dateEl ? dateEl.value : '',
        merchant: merchantEl ? merchantEl.value.trim() : '',
        abn: abnEl ? abnEl.value.trim() : '',
        notes: notesEl ? notesEl.value.trim() : '',
        image: imageEl && imageEl.value ? imageEl.value : null,
        cloudUpdatedAt: Date.now()
    };
    if(editingId){
        for(var i=0;i<invoices.length;i++){
            if(invoices[i].id === editingId){
                invoices.splice(i,1);
                break;
            }
        }
        editingId = null;
    }
    invoices.push(invoice);
    saveData();
    syncInvoiceToCloud(invoice);
    renderInvoices();
    updateStats();

    var form = document.getElementById('addForm');
    if(form) form.reset();
    var pc = document.getElementById('receiptPreviewContainer');
    var ii = document.getElementById('invImage');
    if(pc) pc.style.display = 'none';
    if(ii) ii.value = '';
    capturedImage = null;
    selectCat(document.querySelector('.category-option[data-cat="work"]'));
    
    closeModal('addModal');
    toast('Invoice saved!', 'success');
}

// ---------- EDIT INVOICE ----------
function editInvoice(id) {
    var inv = null;
    for(var i=0;i<invoices.length;i++){
        if(invoices[i].id === id){ inv = invoices[i]; break; }
    }
    if(!inv) return;
    editingId = id;
    var descEl = document.getElementById('invDesc');
    var amountEl = document.getElementById('invAmount');
    var dateEl = document.getElementById('invDate');
    var merchantEl = document.getElementById('invMerchant');
    var abnEl = document.getElementById('invAbn');
    var notesEl = document.getElementById('invNotes');
    if(descEl) descEl.value = inv.description;
    if(amountEl) amountEl.value = inv.amount;
    if(dateEl) dateEl.value = inv.date;
    if(merchantEl) merchantEl.value = inv.merchant || '';
    if(abnEl) abnEl.value = inv.abn || '';
    if(notesEl) notesEl.value = inv.notes || '';
    if(inv.image){
        var preview = document.getElementById('receiptPreview');
        var container = document.getElementById('receiptPreviewContainer');
        var imgInput = document.getElementById('invImage');
        if(preview) preview.src = inv.image;
        if(container) container.style.display = 'block';
        if(imgInput) imgInput.value = inv.image;
        capturedImage = inv.image;
    } else {
        var pc2 = document.getElementById('receiptPreviewContainer');
        var ii2 = document.getElementById('invImage');
        if(pc2) pc2.style.display = 'none';
        if(ii2) ii2.value = '';
    }
    selectCat(document.querySelector('.category-option[data-cat="' + inv.category + '"]'));
    var modal = document.getElementById('addModal');
    if(modal) modal.classList.add('open');
}

// ---------- DELETE INVOICE ----------
function deleteInvoice(id) {
    if(!confirm('Delete this invoice?')) return;
    for(var i=0;i<invoices.length;i++){
        if(invoices[i].id === id){ invoices.splice(i,1); break; }
    }
    saveData();
    removeInvoiceFromCloud(id);
    renderInvoices();
    updateStats();
    toast('Invoice deleted', 'success');
}

// ---------- DETAIL VIEW ----------
function viewInvoice(id) {
    var inv = null;
    for(var i=0;i<invoices.length;i++){
        if(invoices[i].id === id){ inv = invoices[i]; break; }
    }
    if(!inv) return;
    viewingId = id;
    var cat = CATEGORIES[inv.category] || CATEGORIES.other;
    var catIcon = document.getElementById('detailCatIcon');
    var catLabel = document.getElementById('detailCatLabel');
    var desc = document.getElementById('detailDescription');
    var amount = document.getElementById('detailAmount');
    var gst = document.getElementById('detailGst');
    var date = document.getElementById('detailDate');
    var merchant = document.getElementById('detailMerchant');
    var abn = document.getElementById('detailAbn');
    var abnGroup = document.getElementById('detailAbnGroup');
    var notes = document.getElementById('detailNotes');
    var notesGroup = document.getElementById('detailNotesGroup');
    var img = document.getElementById('detailImage');
    var imgGroup = document.getElementById('detailImageGroup');
    if(catIcon){
        catIcon.style.background = cat.color + '20';
        catIcon.style.color = cat.color;
        catIcon.innerHTML = '<i class="fas ' + cat.icon + '"></i>';
    }
    if(catLabel) catLabel.textContent = cat.label;
    if(desc) desc.textContent = inv.description || 'No description';
    if(amount) amount.textContent = fmt$(inv.amount);
    if(gst) gst.textContent = 'GST: ' + fmt$(inv.amount / 11);
    if(date) date.textContent = fmtDate(inv.date);
    if(merchant) merchant.textContent = inv.merchant || 'Unknown merchant';
    if(inv.abn){
        if(abn) abn.textContent = inv.abn;
        if(abnGroup) abnGroup.style.display = 'block';
    } else {
        if(abnGroup) abnGroup.style.display = 'none';
    }
    if(inv.notes){
        if(notes) notes.textContent = inv.notes;
        if(notesGroup) notesGroup.style.display = 'block';
    } else {
        if(notesGroup) notesGroup.style.display = 'none';
    }
    if(inv.image){
        if(img) img.src = inv.image;
        if(imgGroup) imgGroup.style.display = 'block';
    } else {
        if(imgGroup) imgGroup.style.display = 'none';
    }
    var modal = document.getElementById('detailModal');
    if(modal) modal.classList.add('open');
}

function editFromDetail() {
    closeModal('detailModal');
    if(viewingId) editInvoice(viewingId);
}

function deleteFromDetail() {
    if(!viewingId) return;
    closeModal('detailModal');
    deleteInvoice(viewingId);
    viewingId = null;
}

// ---------- VIEW IMAGE FULLSCREEN ----------
function viewImage(src) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = '<img src="' + src + '" style="max-width:100%;max-height:100%;border-radius:12px;object-fit:contain;cursor:pointer">';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}

// ---------- TAX REPORT ----------
function openTaxReport() {
    var cats = ['work','vehicle','home','health','education','investment','donation','other'];
    var fyInv = getFYInvoices();
    var totals = {};
    var grandTotal = 0;
    for(var i=0;i<cats.length;i++){
        var c = cats[i];
        var sum = 0;
        for(var j=0;j<fyInv.length;j++){
            if(fyInv[j].category === c) sum += fyInv[j].amount;
        }
        totals[c] = sum;
        grandTotal += sum;
        var el = document.getElementById('report' + c.charAt(0).toUpperCase() + c.slice(1));
        if(el) el.textContent = fmt$(sum);
    }
    var totalEl = document.getElementById('reportTotal');
    var benefitEl = document.getElementById('reportBenefit');
    var fyLabel = document.getElementById('fyReportLabel');
    if(totalEl) totalEl.textContent = fmt$(grandTotal);
    if(benefitEl) benefitEl.textContent = fmt$(grandTotal * taxRate);
    if(fyLabel) fyLabel.textContent = 'Tax Summary FY ' + currentFY;
    var barColors = {work:'#38bdf8',vehicle:'#fbbf24',home:'#4ade80',health:'#f87171',education:'#a78bfa',investment:'#f472b6',donation:'#4ade80',other:'#94a3b8'};
    var barsEl = document.getElementById('reportBars');
    if(barsEl){
        var barsHtml = '';
        for(var k=0;k<cats.length;k++){
            var cat = cats[k];
            var val = totals[cat];
            var pct = grandTotal > 0 ? (val/grandTotal*100) : 0;
            barsHtml += '<div style="margin-bottom:14px">' +
                '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
                '<span style="color:var(--text-muted)">' + CATEGORIES[cat].label + '</span>' +
                '<span style="font-weight:600">' + fmt$(val) + ' (' + pct.toFixed(1) + '%)</span></div>' +
                '<div class="report-bar"><div class="report-bar-fill" style="width:' + pct + '%;background:' + barColors[cat] + '"></div></div></div>';
        }
        barsEl.innerHTML = barsHtml;
    }
    var modal = document.getElementById('reportModal');
    if(modal) modal.classList.add('open');
}

function openExportHub() {
    document.querySelectorAll('.nav-btn').forEach(function(btn){ btn.classList.remove('active'); });
    document.getElementById('navExport').classList.add('active');
    openTaxReport();
    setTimeout(function(){
        var options = document.getElementById('exportOptions');
        if(options) options.scrollIntoView({behavior:'smooth',block:'center'});
    }, 150);
}

function openSummary() {
    document.querySelectorAll('.nav-btn').forEach(function(btn){ btn.classList.remove('active'); });
    document.getElementById('navSummary').classList.add('active');
    openTaxReport();
}

// ---------- EXPORT CSV ----------
function exportCSV() {
    var headers = ['Date','Category','Description','Merchant','Amount','GST','ABN','Notes'];
    var rows = [];
    var exportInvoices = getFYInvoices();
    for(var i=0;i<exportInvoices.length;i++){
        var inv = exportInvoices[i];
        rows.push('"' + inv.date + '","' + inv.category + '","' + (inv.description||'') + '","' + (inv.merchant||'') + '","' + inv.amount.toFixed(2) + '","' + (inv.amount/11).toFixed(2) + '","' + (inv.abn||'') + '","' + (inv.notes||'') + '"');
    }
    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], {type:'text/csv'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'DeductTrack_FY_' + currentFY + '_Export.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported!', 'success');
}

// ---------- SETTINGS ----------
function openSettings() {
    var modal = document.getElementById('settingsModal');
    if(modal) modal.classList.add('open');
}

function updateSettingsUI() {
    var taxSelect = document.getElementById('taxRate');
    if(taxSelect) taxSelect.value = taxRate;
    var incomeInput = document.getElementById('userIncome');
    if(incomeInput) incomeInput.value = userIncome;
    var fyDisplay = document.getElementById('fyDisplay');
    if(fyDisplay) fyDisplay.textContent = currentFY;
    var fyClear = document.getElementById('fyClearLabel');
    if(fyClear) fyClear.textContent = currentFY;
    var customOcrInput = document.getElementById('customOcrUrl');
    if(customOcrInput) customOcrInput.value = localStorage.getItem('customOcrUrl') || '';
}

function saveCustomOcrUrl() {
    var input = document.getElementById('customOcrUrl');
    if(input) {
        var url = input.value.trim();
        localStorage.setItem('customOcrUrl', url);
        if(url) {
            toast('Custom Python EasyOCR URL saved!', 'success');
        } else {
            toast('Reset to default OCR engine', 'success');
        }
    }
}

function updateTaxRate() {
    var select = document.getElementById('taxRate');
    if(select){
        taxRate = parseFloat(select.value);
        saveData();
        updateStats();
        toast('Tax rate updated', 'success');
    }
}

function updateIncome() {
    var input = document.getElementById('userIncome');
    if(input){
        userIncome = parseFloat(input.value) || 70000;
        var bracket = null;
        for(var i=0;i<TAX_BRACKETS.length;i++){
            if(userIncome >= TAX_BRACKETS[i].min && userIncome <= TAX_BRACKETS[i].max){
                bracket = TAX_BRACKETS[i]; break;
            }
        }
        if(!bracket) bracket = TAX_BRACKETS[2];
        taxRate = bracket.rate;
        var taxSelect = document.getElementById('taxRate');
        if(taxSelect) taxSelect.value = taxRate;
        saveData();
        updateStats();
        toast('Income updated. Bracket: ' + bracket.label, 'success');
    }
}

function toggleSetting(el) {
    if(el) el.classList.toggle('on');
}

// ---------- FY SWITCHING ----------
function changeFY(dir) {
    var parts = currentFY.split('-');
    var startYear = parseInt('20' + parts[0]);
    if(dir === 'next') startYear += 1; else startYear -= 1;
    var endYear = (startYear + 1).toString().slice(-2);
    currentFY = startYear.toString().slice(-2) + '-' + endYear;
    saveData();
    updateSettingsUI();
    renderInvoices();
    updateStats();
    toast('Switched to FY ' + currentFY, 'success');
}

// ---------- CLEAR DATA ----------
function clearFYData() {
    var fy = getFYDates();
    var count = 0;
    for(var i=0;i<invoices.length;i++){
        var d = new Date(invoices[i].date);
        if(d >= fy.start && d <= fy.end) count++;
    }
    if(count === 0){ toast('No invoices to delete for FY ' + currentFY, 'error'); return; }
    if(!confirm('Delete ALL ' + count + ' invoices for FY ' + currentFY + '?\nThis cannot be undone.')) return;
    var kept = [];
    for(var j=0;j<invoices.length;j++){
        var d2 = new Date(invoices[j].date);
        if(d2 < fy.start || d2 > fy.end) kept.push(invoices[j]);
    }
    invoices = kept;
    saveData();
    renderInvoices();
    updateStats();
    toast('FY ' + currentFY + ' cleared!', 'success');
}

function clearAllData() {
    if(!confirm('Delete ALL invoices across ALL years?\nThis cannot be undone.')) return;
    invoices = [];
    saveData();
    renderInvoices();
    updateStats();
    toast('All data cleared!', 'success');
    closeModal('settingsModal');
}

// ---------- ZIP EXPORT ----------
var zipMode = 'category';

function openZipModal() {
    populateZipFinancialYears();
    updateZipCount();
    var modal = document.getElementById('zipModal');
    if(modal) modal.classList.add('open');
}

function populateZipFinancialYears() {
    var select = document.getElementById('zipFYSelect');
    if(!select) return;
    var previous = select.value || currentFY;
    var years = getInvoiceFinancialYears(false);
    if(!years.length) {
        select.innerHTML = '<option value="">No invoice years available</option>';
        return;
    }
    var html = '';
    for(var i=0;i<years.length;i++) html += '<option value="' + years[i] + '">FY ' + years[i] + '</option>';
    select.innerHTML = html;
    select.value = years.indexOf(previous) !== -1 ? previous : (years.indexOf(currentFY) !== -1 ? currentFY : years[0]);
}

function setZipMode(mode) {
    zipMode = mode;
    document.getElementById('zipByCat').classList.toggle('active', mode === 'category');
    document.getElementById('zipByMonth').classList.toggle('active', mode === 'month');
}

function updateZipCount() {
    var fySelect = document.getElementById('zipFYSelect');
    var selectedFY = fySelect ? fySelect.value : currentFY;
    var count = 0;
    for(var i=0;i<invoices.length;i++){
        var inv = invoices[i];
        if(!inv.image) continue;
        if(selectedFY) {
            var fyDates = getFYDatesFromString(selectedFY);
            var d = new Date(inv.date);
            if(d >= fyDates.start && d <= fyDates.end) count++;
        }
    }
    var countEl = document.getElementById('zipCount');
    if(countEl) countEl.textContent = count;
}

function getFYDatesFromString(fyStr) {
    if(!fyStr) return {start: new Date('2099-01-01'), end: new Date('2099-01-01')};
    var parts = fyStr.split('-');
    var startYear = parseInt('20' + parts[0]);
    return {
        start: new Date(startYear + '-07-01'),
        end: new Date((startYear + 1) + '-06-30')
    };
}

function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    for(var i=0;i<n;i++){
        u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], {type: mime});
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
}

function exportImagesZip() {
    if(typeof JSZip === 'undefined'){
        toast('ZIP library not loaded. Check internet connection.', 'error');
        return;
    }

    var fySelect = document.getElementById('zipFYSelect');
    var selectedFY = fySelect ? fySelect.value : currentFY;
    var fyDates = getFYDatesFromString(selectedFY);

    var zipInvoices = [];
    for(var i=0;i<invoices.length;i++){
        var inv = invoices[i];
        if(!inv.image) continue;
        var d = new Date(inv.date);
        if(d >= fyDates.start && d <= fyDates.end){
            zipInvoices.push(inv);
        }
    }

    if(zipInvoices.length === 0){
        toast('No images to export for selected FY.', 'error');
        return;
    }

    toast('Creating ZIP with ' + zipInvoices.length + ' images...', 'success');

    var zip = new JSZip();

    for(var j=0;j<zipInvoices.length;j++){
        var inv = zipInvoices[j];
        var desc = sanitizeFilename(inv.description || 'Invoice');
        var dateStr = inv.date;
        var filename = desc + '_' + dateStr + '.jpg';
        var folder = '';

        if(zipMode === 'category'){
            var cat = CATEGORIES[inv.category] || CATEGORIES.other;
            folder = cat.label + '/';
        } else {
            var d = new Date(inv.date);
            var month = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
            folder = month + '/';
        }

        var blob = dataURLtoBlob(inv.image);
        zip.file(folder + filename, blob);
    }

    zip.generateAsync({type:'blob'}).then(function(content){
        var fyLabel = 'FY_' + selectedFY;
        var modeLabel = zipMode === 'category' ? 'By_Category' : 'By_Month';
        var zipName = 'DeductTrack_Images_' + fyLabel + '_' + modeLabel + '.zip';
        saveAs(content, zipName);
        toast('ZIP downloaded! ' + zipInvoices.length + ' images.', 'success');
        closeModal('zipModal');
    }).catch(function(err){
        console.log('ZIP error:', err);
        toast('Failed to create ZIP. Try fewer images.', 'error');
    });
}

// ---------- TOAST NOTIFICATIONS ----------
function toast(msg, type) {
    var el = document.getElementById('toast');
    if(!el) return;
    var icon = el.querySelector('i');
    var msgEl = document.getElementById('toastMsg');
    if(msgEl) msgEl.textContent = msg;
    el.className = 'toast show ' + (type||'success');
    if(icon) {
        if(type === 'ai') icon.className = 'fas fa-wand-magic-sparkles';
        else if(type === 'error') icon.className = 'fas fa-exclamation-circle';
        else icon.className = 'fas fa-check-circle';
    }
    setTimeout(function(){ el.classList.remove('show'); }, 3200);
}

// ---------- START ----------
document.addEventListener('DOMContentLoaded', init);
