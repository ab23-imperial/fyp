import { auth, googleProvider } from "./firebase.js";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// redirect if already logged in
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "/route.html";
  }
});

// ── GOOGLE LOGIN ──
const googleBtn = document.getElementById("google-login");

googleBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log("SIGNED IN:", result.user);
    window.location.href = "/route.html";
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// ── EMAIL/PASSWORD LOGIN ──
const emailForm = document.getElementById("email-form");

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log("SIGNED IN:", userCredential.user);
    window.location.href = "/route.html";
  } catch (err) {
    console.error(err);

    // friendly error messages
    let message = err.message;
    if (err.code === "auth/invalid-credential") {
      message = "Invalid email or password. Please try again.";
    } else if (err.code === "auth/user-not-found") {
      message = "No account found with this email. Please sign up first.";
    } else if (err.code === "auth/wrong-password") {
      message = "Incorrect password. Please try again.";
    }

    alert(message);
  }
});