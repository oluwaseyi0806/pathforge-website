// js/script.js
// PathForge CAM — Website Logic
//
// STATUS: DEMO MODE.
// Account sign-up and checkout below are placeholders so you can see and click
// through the full flow. Nothing here is saved to a real database yet, and no
// real payment is processed. Follow the phase plan to replace each TODO below
// with a real implementation:
//   Phase 3 -> Supabase real accounts (replaces handleAuthSubmit)
//   Phase 6 -> Paystack + Bitcoin real checkout (replaces handleCheckoutSubmit)
//   Phase 4/5 -> Per-tier signed license files (replaces the single shared download link)

let currentTier = 'personal';
let currentPrice = 299;

// Demo-only session state. Resets on page refresh — this is NOT a real login.
let userAccountSession = {
    registered: false,
    email: '',
    tierAllocated: ''
};

// TODO (Phase 4/5): Replace this single shared file with a per-order signed
// license + build download issued by your backend after payment is confirmed.
// Right now every tier points at the same file, which means tiers aren't
// actually enforced yet.
const GOOGLE_DRIVE_FILE_ID = "15339rGiynlR26c5UEEPLWN9gubb04y-2";
const DIRECT_DOWNLOAD_URL = `https://drive.google.com/uc?export=download&id=${GOOGLE_DRIVE_FILE_ID}`;

/**
 * Switches the account panel between Sign Up and Log In views.
 */
function toggleAuthMode(mode) {
    const signupTab = document.getElementById('tab-signup');
    const loginTab = document.getElementById('tab-login');
    const targetTitle = document.getElementById('auth-portal-title');
    const confirmRow = document.getElementById('password-confirm-row');
    const actionBtnText = document.getElementById('auth-submit-text');

    if (mode === 'login') {
        signupTab.classList.remove('border-[#00E5FF]', 'text-[#00E5FF]');
        signupTab.classList.add('border-transparent', 'text-[#A0A4B0]');
        loginTab.classList.add('border-[#00E5FF]', 'text-[#00E5FF]');

        targetTitle.innerText = "Log In To Your Account";
        confirmRow.classList.add('hidden');
        document.getElementById('auth-confirm-password').removeAttribute('required');
        actionBtnText.innerText = "Log In";
    } else {
        loginTab.classList.remove('border-[#00E5FF]', 'text-[#00E5FF]');
        loginTab.classList.add('border-transparent', 'text-[#A0A4B0]');
        signupTab.classList.add('border-[#00E5FF]', 'text-[#00E5FF]');

        targetTitle.innerText = "Create Your Account";
        confirmRow.classList.remove('hidden');
        document.getElementById('auth-confirm-password').setAttribute('required', 'true');
        actionBtnText.innerText = "Create Account";
    }
}

/**
 * DEMO ONLY — handles the sign-up/log-in form.
 * TODO (Phase 3): Replace this whole function body with real Supabase calls:
 *   supabase.auth.signUp({ email, password })
 *   supabase.auth.signInWithPassword({ email, password })
 */
function handleAuthSubmit(event) {
    event.preventDefault();

    const emailInput = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const confirmPass = document.getElementById('auth-confirm-password').value;
    const isSignup = !document.getElementById('password-confirm-row').classList.contains('hidden');

    if (isSignup && password !== confirmPass) {
        alert("Passwords don't match. Please re-enter them.");
        return;
    }

    // Demo-only session cache — not persisted anywhere real yet.
    userAccountSession.registered = true;
    userAccountSession.email = emailInput;
    userAccountSession.tierAllocated = currentTier;

    document.getElementById('customer-email').value = emailInput;
    document.getElementById('auth-success-badge').classList.remove('hidden');
    document.getElementById('active-user-display').innerText = emailInput;

    alert(`Signed in as ${emailInput}. Scroll down to complete your order.`);
}

/**
 * Updates the selected license tier's card styling and the checkout summary.
 */
function selectLicense(tier, price) {
    currentTier = tier;
    currentPrice = price;

    document.querySelectorAll('.license-card').forEach(card => {
        card.classList.remove('border-[#00E5FF]', 'shadow-[0_0_25px_rgba(0,229,255,0.15)]', 'bg-[#2C2D35]');
        card.classList.add('border-[#3A3C44]', 'bg-[#222329]');
    });

    document.querySelectorAll('.license-badge').forEach(badge => {
        badge.classList.remove('bg-[#00E5FF]', 'text-[#1A1B20]');
        badge.classList.add('bg-[#2F313B]', 'text-[#A0A4B0]');
    });

    const activeCard = document.getElementById(`tier-${tier}`);
    if (activeCard) {
        activeCard.classList.remove('border-[#3A3C44]', 'bg-[#222329]');
        activeCard.classList.add('border-[#00E5FF]', 'shadow-[0_0_25px_rgba(0,229,255,0.15)]', 'bg-[#2C2D35]');
    }

    const activeBadge = document.getElementById(`badge-${tier}`);
    if (activeBadge) {
        activeBadge.classList.remove('bg-[#2F313B]', 'text-[#A0A4B0]');
        activeBadge.classList.add('bg-[#00E5FF]', 'text-[#1A1B20]');
    }

    document.getElementById('summary-tier-name').innerText = tier.toUpperCase();
    document.getElementById('summary-display-price').innerText = price === 0 ? 'FREE' : `$${price}.00`;

    const paymentGate = document.getElementById('payment-channels-gate');
    const academicGate = document.getElementById('academic-instant-gate');
    const actionBtnText = document.getElementById('submit-btn-text');

    if (price === 0) {
        paymentGate.classList.add('hidden');
        academicGate.classList.remove('hidden');
    } else {
        paymentGate.classList.remove('hidden');
        academicGate.classList.add('hidden');
        actionBtnText.innerText = `Pay — $${price}.00`;
    }

    document.getElementById('checkout').scrollIntoView({ behavior: 'smooth' });
}

/**
 * DEMO ONLY — handles the paid-tier checkout form submit.
 * TODO (Phase 6): Replace this whole function body with a call to your
 * backend, which creates an order and redirects to Paystack Checkout (or
 * your Bitcoin processor's payment page). The real download/license should
 * only be issued after your backend receives a confirmed payment webhook —
 * never directly from this front-end code.
 */
function handleCheckoutSubmit(event) {
    event.preventDefault();

    if (!userAccountSession.registered) {
        alert("Please sign up or log in above before checking out.");
        document.getElementById('account').scrollIntoView({ behavior: 'smooth' });
        return;
    }

    const targetEmail = document.getElementById('customer-email').value;

    alert(`[DEMO] This would charge $${currentPrice}.00 and email a license to ${targetEmail}. Real payment isn't wired up yet — that's Phase 6.`);
    window.location.href = DIRECT_DOWNLOAD_URL;
}

/**
 * DEMO ONLY — Academic tier instant download.
 * TODO (Phase 4/5): Issue a real Academic-tier signed license alongside the
 * download once the license key system exists.
 */
function triggerAcademicDownload() {
    if (!userAccountSession.registered) {
        alert("Please sign up or log in above before downloading.");
        document.getElementById('account').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    alert("Starting your download of the Academic edition.");
    window.location.href = DIRECT_DOWNLOAD_URL;
}
