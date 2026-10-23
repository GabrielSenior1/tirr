// ============================================================
// TIRR SCORING PLATFORM - Firebase Configuration
// SDK v12 Modular (Tree-Shakeable)
// ============================================================

// --- Core App ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";

// --- Services ---
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getDatabase, ref, set, get, push, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";

// ============================================================
// 🔥 ACTUAL FIREBASE PROJECT CONFIGURATION
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyBwv_bKh3ebdiuwWkDZZAiL3V03fhbsoNQ",
    authDomain: "tirr-platform-score.firebaseapp.com",
    projectId: "tirr-platform-score",
    storageBucket: "tirr-platform-score.firebasestorage.app",
    messagingSenderId: "735996722696",
    appId: "1:735996722696:web:7ab9262139c95364349bbd",
    databaseURL: "https://tirr-platform-score-default-rtdb.firebaseio.com" // Default RTDB URL
};

// ============================================================
// Initialize Firebase
// ============================================================
const app = initializeApp(firebaseConfig);

// ============================================================
// Initialize Services
// ============================================================
const auth     = getAuth(app);
const db       = getFirestore(app);    // Cloud Firestore
const rtdb     = getDatabase(app);     // Realtime Database
const storage  = getStorage(app, "gs://tirr-platform-score.firebasestorage.app");      // Firebase Storage

// ============================================================
// Auth Observer - Tracks signed-in user globally
// ============================================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("✅ Usuario autenticado:", user.email);
    window._currentUser = user;
    // Dispatch custom event so Alpine.js components can react
    document.dispatchEvent(new CustomEvent("auth:ready", { detail: { user } }));
  } else {
    console.log("🔒 Usuario no autenticado.");
    window._currentUser = null;
    document.dispatchEvent(new CustomEvent("auth:signedout"));
  }
});

// ============================================================
// Exports - Available to all modules
// ============================================================
export {
  app,
  auth,
  db,
  rtdb,
  storage,

  // Auth helpers
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,

  // Firestore helpers
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,

  // Realtime Database helpers
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  off,

  // Storage helpers
  storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
};

