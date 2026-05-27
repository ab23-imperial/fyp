import { auth, googleProvider } from "./firebase.js";
import {
  signInWithPopup,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// redirect if already logged in
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "/route.html";
});

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

// ── GOOGLE SIGNUP ──
document.getElementById("google-signup").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
    window.location.href = "/route.html";
  } catch (err) {
    showError(err.message);
  }
});

// ── EMAIL/PASSWORD SIGNUP ──
document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm  = document.getElementById("confirm").value;
  const btn      = document.getElementById("submit-btn");

  if (password !== confirm) {
    showError("Passwords do not match.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creating account…";

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    window.location.href = "/route.html";
  } catch (err) {
    let message = err.message;
    if (err.code === "auth/email-already-in-use") {
      message = "An account with this email already exists. Sign in instead.";
    } else if (err.code === "auth/invalid-email") {
      message = "Please enter a valid email address.";
    } else if (err.code === "auth/weak-password") {
      message = "Password must be at least 6 characters.";
    }
    showError(message);
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
});
