// ============================================================
// MODULE: Teams Registration
// Handles: CRUD for teams, photo upload, categories
// ============================================================
import { db, storage, collection, addDoc, updateDoc, deleteDoc, doc,
         storageRef, uploadBytesResumable, getDownloadURL, deleteObject }
  from '../firebase-config.js';
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// ── Categories configuration ─────────────────────────────────
export const CATEGORIES = [
  { id: 'CAT_A', label: 'Categoría A', color: '#E60000', ageRange: '6-8 años' },
  { id: 'CAT_B', label: 'Categoría B', color: '#FFD700', ageRange: '9-11 años' },
  { id: 'CAT_C', label: 'Categoría C', color: '#FFFFFF', ageRange: '12-14 años' },
];

// ── Default team shape ────────────────────────────────────────
export const defaultTeam = () => ({
  name: '',
  school: '',
  members: ['', ''],
  category: 'CAT_A',
  weight: '',    // grams
  height: '',    // cm
  span: '',      // cm (wingspan)
  photoURL: null,
  notes: '',
});

// ── Create team ───────────────────────────────────────────────
export async function createTeam(teamData, photoFile = null) {
  try {
    let photoURL = null;

    if (photoFile) {
      const path = `teams/${Date.now()}_${photoFile.name}`;
      const sRef = storageRef(storage, path);
      const snap = await uploadBytesResumable(sRef, photoFile);
      photoURL   = await getDownloadURL(snap.ref);
    }

    const docRef = await addDoc(collection(db, 'teams'), {
      ...teamData,
      photoURL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { success: true, id: docRef.id };
  } catch (err) {
    console.error('createTeam error:', err);
    return { success: false, error: err.message };
  }
}

// ── Update team ───────────────────────────────────────────────
export async function updateTeam(id, data) {
  try {
    await updateDoc(doc(db, 'teams', id), {
      ...data,
      updatedAt: serverTimestamp(),
    });
    return { success: true };
  } catch (err) {
    console.error('updateTeam error:', err);
    return { success: false, error: err.message };
  }
}

// ── Delete team ───────────────────────────────────────────────
export async function deleteTeam(id, photoURL = null) {
  try {
    if (photoURL) {
      const sRef = storageRef(storage, photoURL);
      await deleteObject(sRef).catch(() => {}); // ignore if not found
    }
    await deleteDoc(doc(db, 'teams', id));
    return { success: true };
  } catch (err) {
    console.error('deleteTeam error:', err);
    return { success: false, error: err.message };
  }
}
