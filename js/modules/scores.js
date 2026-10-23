// ============================================================
// MODULE: Scoring System
// Handles: Team evaluation across multiple criteria
// ============================================================
import { db, collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy }
  from '../firebase-config.js';
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// ── Scoring Criteria ──────────────────────────────────────────
export const CRITERIA = [
  { id: 'flight',      label: 'Vuelo',        icon: 'flight_takeoff', max: 25, description: 'Tiempo de vuelo y estabilidad' },
  { id: 'design',      label: 'Diseño',       icon: 'architecture',   max: 25, description: 'Estética y acabado del prototipo' },
  { id: 'innovation',  label: 'Innovación',   icon: 'lightbulb',      max: 25, description: 'Creatividad y originalidad' },
  { id: 'sustentation',label: 'Sustentación', icon: 'air',            max: 25, description: 'Capacidad de sustentación' },
];

// ── Default score shape ───────────────────────────────────────
export const defaultScore = (teamId) => ({
  teamId,
  judgeId: null,
  flight: 0,
  design: 0,
  innovation: 0,
  sustentation: 0,
  totalScore: 0,
  notes: '',
});

// ── Calculate total ───────────────────────────────────────────
export function calculateTotal(scoreData) {
  return (scoreData.flight || 0) +
         (scoreData.design || 0) +
         (scoreData.innovation || 0) +
         (scoreData.sustentation || 0);
}

// ── Submit score ──────────────────────────────────────────────
export async function submitScore(scoreData) {
  try {
    const total = calculateTotal(scoreData);
    const docRef = await addDoc(collection(db, 'scores'), {
      ...scoreData,
      totalScore: total,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { success: true, id: docRef.id, totalScore: total };
  } catch (err) {
    console.error('submitScore error:', err);
    return { success: false, error: err.message };
  }
}

// ── Update score ──────────────────────────────────────────────
export async function updateScore(id, data) {
  try {
    const total = calculateTotal(data);
    await updateDoc(doc(db, 'scores', id), {
      ...data,
      totalScore: total,
      updatedAt: serverTimestamp(),
    });
    return { success: true, totalScore: total };
  } catch (err) {
    console.error('updateScore error:', err);
    return { success: false, error: err.message };
  }
}

// ── Get scores for a team ─────────────────────────────────────
export async function getTeamScores(teamId) {
  try {
    const q = query(collection(db, 'scores'), where('teamId', '==', teamId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('getTeamScores error:', err);
    return [];
  }
}
