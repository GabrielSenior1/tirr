// ============================================================
// MODULE: Chronometer / Timer
// Handles: Precise flight timing with start/stop/reset/lap
// ============================================================
import { db, rtdb, ref, set, onValue, doc, updateDoc }
  from '../firebase-config.js';
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// ── Timer State Factory ──────────────────────────────────────
export function createTimerState() {
  return {
    isRunning: false,
    startTime: 0,
    elapsed: 0,
    laps: [],
    intervalId: null,
    selectedTeamId: null,
    selectedTeamName: '',

    // Format ms to HH:MM:SS.mmm
    get formatted() {
      return formatTime(this.elapsed);
    },

    start() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.startTime = Date.now() - this.elapsed;
      this.intervalId = setInterval(() => {
        this.elapsed = Date.now() - this.startTime;
      }, 10);
    },

    stop() {
      if (!this.isRunning) return;
      this.isRunning = false;
      clearInterval(this.intervalId);
      this.intervalId = null;
    },

    reset() {
      this.stop();
      this.elapsed = 0;
      this.laps = [];
    },

    lap() {
      if (!this.isRunning) return;
      this.laps.push({
        index: this.laps.length + 1,
        time: this.elapsed,
        formatted: formatTime(this.elapsed),
        timestamp: Date.now(),
      });
    },

    selectTeam(id, name) {
      this.selectedTeamId = id;
      this.selectedTeamName = name;
    },
  };
}

// ── Format time helper ────────────────────────────────────────
export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

// ── Save timing result to Firestore ───────────────────────────
export async function saveTimingResult(teamId, elapsed, laps = []) {
  try {
    const { addDoc, collection } = await import('../firebase-config.js');
    const docRef = await addDoc(collection(db, 'timings'), {
      teamId,
      elapsed,
      formatted: formatTime(elapsed),
      laps,
      createdAt: serverTimestamp(),
    });
    return { success: true, id: docRef.id };
  } catch (err) {
    console.error('saveTimingResult error:', err);
    return { success: false, error: err.message };
  }
}

// ── Sync timer to RTDB for live display ──────────────────────
export function syncTimerToRTDB(timerData) {
  const timerRef = ref(rtdb, 'liveTimer');
  return set(timerRef, {
    isRunning: timerData.isRunning,
    elapsed: timerData.elapsed,
    teamId: timerData.selectedTeamId,
    teamName: timerData.selectedTeamName,
    updatedAt: Date.now(),
  });
}

// ── Listen to live timer from RTDB ───────────────────────────
export function onLiveTimer(callback) {
  const timerRef = ref(rtdb, 'liveTimer');
  return onValue(timerRef, (snapshot) => {
    callback(snapshot.val());
  });
}
