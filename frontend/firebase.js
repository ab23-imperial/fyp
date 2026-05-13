// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6qyc6oWeko46O4tT24INK4QsWO3GjiGw",
  authDomain: "fypbeng-5dbc7.firebaseapp.com",
  projectId: "fypbeng-5dbc7",
  storageBucket: "fypbeng-5dbc7.firebasestorage.app",
  messagingSenderId: "737620451856",
  appId: "1:737620451856:web:3093577944bf8b1ab1a095",
  measurementId: "G-65S8XBYVTK"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence);

export const googleProvider = new GoogleAuthProvider();